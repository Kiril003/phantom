from __future__ import annotations
import uuid
import time
import json
import pytest
from sqlalchemy import select
from unittest.mock import MagicMock, AsyncMock

from db.models import User
from db.tom_models import Episode, SemanticMemory, SemanticSource, Belief, BeliefEvidence, Contradiction, Hypothesis, ReflectionQueue
from db.database import get_session, init_db
from memory.tom_service import log_episode, check_active_probes, affect_match_retrieve, get_tom_prompt_context
from memory.tom_dream import dream_reflect


@pytest.fixture()
async def tom_user_and_db():
    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        from sqlalchemy import text
        await db.execute(text("DELETE FROM episodes"))
        await db.execute(text("DELETE FROM reflection_queue"))
        await db.execute(text("DELETE FROM beliefs"))
        await db.execute(text("DELETE FROM belief_evidence"))
        await db.execute(text("DELETE FROM contradictions"))
        await db.execute(text("DELETE FROM hypotheses"))
        await db.execute(text("DELETE FROM semantic_memory"))
        await db.execute(text("DELETE FROM semantic_source"))
        await db.execute(text("DELETE FROM epochs"))
        await db.execute(text("DELETE FROM dream_mutations"))
        await db.execute(text("DELETE FROM dream_jobs"))
        await db.execute(text("DELETE FROM vault_cards"))
        await db.commit()

        db.add(
            User(
                id=user_id,
                username=f"pytest_tom_{user_id[:8]}",
                role="ROOT",
                pin_hash="x",
                rfid_uid_hash=None,
                preferences_json="{}",
            )
        )
        await db.commit()

    async with get_session() as db:
        yield user_id, db


@pytest.mark.asyncio
async def test_tom_hotpath_logging_and_probes(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # 1. Log a user episode turn
    session_id = "session_tom_1"
    prosody = {"valence": 0.3, "arousal": 0.8, "fatigue": 0.2, "hesitation": 0.1}
    context = {"cpu": 12.0, "ram": 45.0, "gps": "Lviv"}

    episode_id = await log_episode(
        db=db,
        session_id=session_id,
        role="user",
        content="Привіт, я сьогодні дуже втомився.",
        prosody=prosody,
        context_snap=context,
        importance=0.7
    )
    await db.commit()

    # Verify episode was inserted
    res_ep = await db.execute(select(Episode).where(Episode.id == episode_id))
    ep = res_ep.scalar_one_or_none()
    assert ep is not None
    assert ep.session_id == session_id
    assert ep.role == "user"
    assert json.loads(ep.prosody)["valence"] == 0.3
    assert json.loads(ep.context_snap)["gps"] == "Lviv"

    # 2. Add a pending belief and hypothesis/probe
    belief = Belief(
        subject="user",
        statement="Користувач працює ночами.",
        predicate_key="work_schedule",
        value="night_shift",
        belief_type="pattern",
        confidence=0.5,
        log_odds=0.0,
        status="active",
        created_at=time.time(),
        updated_at=time.time()
    )
    db.add(belief)
    await db.flush()

    hyp = Hypothesis(
        belief_id=belief.id,
        text="Чи ти працюєш вночі?",
        test_mode="active_probe",
        probe_hint="Запитай ненав'язливо про нічну роботу",
        status="pending",
        created_at=time.time()
    )
    db.add(hyp)
    await db.commit()

    # Mock LLM response to confirm active probe
    class FakeLLMResult:
        def __init__(self, content):
            self.content = content

    mock_dispatch = AsyncMock(return_value=FakeLLMResult("CONFIRMED - гіпотеза підтверджується реплікою."))
    import ai.hub
    monkeypatch.setattr(ai.hub.ai_hub, "dispatch", mock_dispatch)

    # Check active probes
    await check_active_probes(db, user_id, "Так, я працюю на нічній зміні.")
    await db.commit()

    # Verify hypothesis status updated to confirmed
    res_hyp = await db.execute(select(Hypothesis).where(Hypothesis.id == hyp.id))
    hyp_fresh = res_hyp.scalar_one_or_none()
    assert hyp_fresh.status == "confirmed"

    # Verify belief confidence increased
    res_b = await db.execute(select(Belief).where(Belief.id == belief.id))
    belief_fresh = res_b.scalar_one_or_none()
    assert belief_fresh.log_odds > 0.0
    assert belief_fresh.confidence > 0.5

    # Verify reflection queue contains item
    res_rq = await db.execute(select(ReflectionQueue).where(ReflectionQueue.consumed == 0))
    rq = res_rq.scalars().all()
    assert len(rq) == 1
    assert rq[0].kind == "probe_outcome"


@pytest.mark.asyncio
async def test_tom_affect_match_retrieve(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # Create mock episodes in SQLite
    now = time.time()
    ep1 = Episode(
        session_id="s1", ts=now - 10, role="user", content="Я спокійний та щасливий.",
        embedding_id="strategic_1",
        prosody=json.dumps({"valence": 0.8, "arousal": 0.3, "fatigue": 0.0, "hesitation": 0.0}),
        importance=0.8, last_accessed=now, dream_processed=1
    )
    ep2 = Episode(
        session_id="s1", ts=now - 5, role="user", content="Я в паніці, все горить!",
        embedding_id="strategic_2",
        prosody=json.dumps({"valence": 0.1, "arousal": 0.9, "fatigue": 0.1, "hesitation": 0.2}),
        importance=0.9, last_accessed=now, dream_processed=1
    )
    db.add(ep1)
    db.add(ep2)
    await db.commit()

    # Mock Chroma retrieve with distance
    mock_query = AsyncMock(return_value=[
        {"id": "strategic_1", "content": "Я спокійний та щасливий.", "distance": 0.1},
        {"id": "strategic_2", "content": "Я в паніці, все горить!", "distance": 0.2}
    ])
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "query_with_distances", mock_query)
    # Mock store_fact inside incrementing recall count
    monkeypatch.setattr(memory.strategic_memory, "store_fact", AsyncMock())

    # Case A: Calm query prosody -> should rank ep1 higher
    calm_prosody = {"valence": 0.7, "arousal": 0.2, "fatigue": 0.0, "hesitation": 0.0}
    hits_calm = await affect_match_retrieve(db, user_id, "Я хочу відпочити", calm_prosody, k=2)
    assert len(hits_calm) == 2
    assert hits_calm[0] == "Я спокійний та щасливий."

    # Case B: Stressed query prosody -> Valence < 0.4 and Arousal > 0.7 -> weight w_aff is inverted
    # With inverted affect weight, the target should be counter-affective (comforting/calming memory), which is ep1.
    # Therefore, even though the query is stressed, it prefers the opposite comforting state ep1.
    stressed_prosody = {"valence": 0.2, "arousal": 0.8, "fatigue": 0.5, "hesitation": 0.3}
    hits_stress = await affect_match_retrieve(db, user_id, "Все погано", stressed_prosody, k=2)
    assert len(hits_stress) == 2
    assert hits_stress[0] == "Я спокійний та щасливий."


@pytest.mark.asyncio
async def test_tom_dream_reflect_cycle(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # Create raw episode dialogue needing DREAM processing
    ep = Episode(
        session_id="session_dream_1", ts=time.time(), role="user",
        content="Я збираюсь спати о 23:00 щодня.",
        dream_processed=0
    )
    hint = ReflectionQueue(
        kind="affect_spike",
        payload=json.dumps({"session_id": "session_dream_1"}),
        priority=0,
        created_at=time.time(),
        consumed=0
    )
    db.add(ep)
    db.add(hint)
    await db.commit()

    # Mock strategic memory store fact
    mock_store = AsyncMock()
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "store_fact", mock_store)
    monkeypatch.setattr(memory.strategic_memory, "seal_fact", AsyncMock())

    # Mock AI replies for Phase 1 Consolidation, Phase 2 ToM extraction, and Phase 4 Probing Hypotheses
    class FakeLLMResult:
        def __init__(self, content):
            self.content = content

    async def fake_dispatch(action, payload, provider_hint=None):
        msg = payload.get("user_message", "")
        if "консолідації пам'яті" in msg:
            # Stage 1: consolidation output
            return FakeLLMResult('[{"statement": "Користувач лягає спати о 23:00.", "topic_key": "sleep_schedule", "importance": 0.7}]')
        elif "Theory of Mind" in msg:
            # Stage 2: belief extraction output
            return FakeLLMResult(
                '['
                '  {'
                '    "statement": "Користувач віддає перевагу ранньому сну.",'
                '    "belief_type": "preference",'
                '    "predicate_key": "sleep_schedule",'
                '    "value": "early_bird",'
                '    "confidence": 0.8,'
                '    "evidence_source_id": 1'
                '  }'
                ']'
            )
        elif "active_probe" in msg:
            # Stage 4: probing hypotheses output
            return FakeLLMResult('[]')
        return FakeLLMResult('[]')

    import ai.hub
    monkeypatch.setattr(ai.hub.ai_hub, "dispatch", fake_dispatch)

    monkeypatch.setattr("memory.tom_dream.dream_admissible", AsyncMock(return_value=(True, "ok")))

    # Run reflection
    result = await dream_reflect(db, user_id)
    assert result["status"] == "success"
    assert result["stats"]["episodes_processed"] == 1
    assert result["stats"]["semantics_created"] == 1
    assert result["stats"]["beliefs_extracted"] == 1

    # Verify database state
    # Episode marked as processed
    res_ep = await db.execute(select(Episode).where(Episode.id == ep.id))
    assert res_ep.scalar_one().dream_processed == 1

    # Semantic memory created
    res_sm = await db.execute(select(SemanticMemory))
    semantics = res_sm.scalars().all()
    assert len(semantics) == 1
    assert semantics[0].statement == "Користувач лягає спати о 23:00."

    # SemanticSource link verified
    res_src = await db.execute(select(SemanticSource))
    links = res_src.scalars().all()
    assert len(links) == 1
    assert links[0].semantic_id == semantics[0].id
    assert links[0].episode_id == ep.id

    # Belief created
    res_b = await db.execute(select(Belief).where(Belief.status == "active"))
    beliefs = res_b.scalars().all()
    assert len(beliefs) == 1
    assert beliefs[0].statement == "Користувач віддає перевагу ранньому сну."
    assert beliefs[0].predicate_key == "sleep_schedule"


@pytest.mark.asyncio
async def test_pii_guard_auto_vaulting(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # Mock encrypt_field
    mock_encrypt = MagicMock(return_value="mock_vault_token")
    import security.vault_crypto
    monkeypatch.setattr(security.vault_crypto, "encrypt_field", mock_encrypt)

    # 1. Test credit card auto-vaulting
    from security.pii_guard import pii_guard
    text_with_card = "Мій номер картки 4111 1111 1111 1111, будь ласка, збережи її."
    redacted_card = await pii_guard(db, user_id, text_with_card)
    
    assert "4111 1111 1111 1111" not in redacted_card
    assert "⟦vault:" in redacted_card
    
    # Verify card created in DB
    from db.models import VaultCard
    res_card = await db.execute(select(VaultCard).where(VaultCard.owner_user_id == user_id))
    cards = res_card.scalars().all()
    assert len(cards) == 1
    assert cards[0].kind == "payment_method"

    # 2. Test high-entropy API key/token auto-vaulting
    text_with_api = "Ось мій api_key='pbkdf2_sha256_260000_yD8F2hJ9kL1mP3qR5sT7uV9wX1yZ3'"
    redacted_api = await pii_guard(db, user_id, text_with_api)
    
    assert "pbkdf2_sha256_260000_yD8F2hJ9kL1mP3qR5sT7uV9wX1yZ3" not in redacted_api
    assert "⟦vault:" in redacted_api

    res_card_api = await db.execute(select(VaultCard).where(VaultCard.kind == "api_key", VaultCard.owner_user_id == user_id))
    assert len(res_card_api.scalars().all()) == 1


@pytest.mark.asyncio
async def test_reconcile_chroma_embeddings(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # Mock Chroma store_fact
    mock_store = AsyncMock()
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "store_fact", mock_store)

    # Insert an unsynced active belief and semantic fact
    now = time.time()
    sem = SemanticMemory(
        statement="Користувач любить каву.",
        topic_key="preference",
        embedding_id="semantic_reconcile_1",
        importance=0.6,
        decay_score=0.9,
        created_at=now
    )
    b = Belief(
        subject="user",
        statement="Користувач п'є каву вранці.",
        predicate_key="coffee_preference",
        value="morning_coffee",
        belief_type="preference",
        confidence=0.7,
        log_odds=1.0,
        status="active",
        embedding_id="belief_reconcile_1",
        created_at=now,
        updated_at=now
    )
    db.add(sem)
    db.add(b)
    await db.commit()

    from memory.tom_dream import reconcile_chroma_embeddings
    reconciled_count = await reconcile_chroma_embeddings(db, user_id)
    assert reconciled_count == 2
    assert mock_store.call_count == 2


@pytest.mark.asyncio
async def test_salience_arbiter_and_feedback(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # Mock FSM to be in SHADOW
    from core.state_machine import state_machine, SystemState
    state_machine.force_transition(SystemState.SHADOW, "test_init")

    from core.salience_arbiter import emit_candidate, register_notification_feedback, get_trust_credit, set_trust_credit
    # Set starting trust credit
    await set_trust_credit(db, 5.0)
    await db.commit()

    # 1. Emit Tier 2 event below threshold (low salience)
    # Budget in SHADOW is 4.0. With trust_credit=5.0, threshold = 4.0 - (5.0 - 5.0) = 4.0.
    # An event with salience 3.0 should NOT interrupt
    interrupted = await emit_candidate(db, user_id, "critical_battery", "Батарея низька.", 3.0)
    assert not interrupted
    assert state_machine.current_state == SystemState.SHADOW

    # Verify ChatMessage created but interrupted=False
    from db.models import ChatMessage
    res = await db.execute(select(ChatMessage).where(ChatMessage.content == "Батарея низька."))
    msg = res.scalar_one_or_none()
    assert msg is not None
    meta = json.loads(msg.metadata_json)
    assert not meta["interrupted"]

    # 2. Emit Tier 2 event above threshold (high salience)
    # Event with salience 5.5 should interrupt
    interrupted_high = await emit_candidate(db, user_id, "security_alert", "Хтось наближається!", 5.5)
    assert interrupted_high
    assert state_machine.current_state == SystemState.SENTINEL

    # Verify FSM changed state and ChatMessage has interrupted=True
    res_sec = await db.execute(select(ChatMessage).where(ChatMessage.content == "Хтось наближається!"))
    msg_sec = res_sec.scalar_one_or_none()
    assert msg_sec is not None
    meta_sec = json.loads(msg_sec.metadata_json)
    assert meta_sec["interrupted"]

    # 3. Test trust credit drift feedback
    # Accept the notification -> trust goes up
    new_credit = await register_notification_feedback(db, msg_sec.id, accepted=True)
    assert new_credit == 5.5

    # Ignore/dismiss -> trust goes down
    newer_credit = await register_notification_feedback(db, msg_sec.id, accepted=False)
    assert newer_credit == 4.5


@pytest.mark.asyncio
async def test_ssml_dysfluency_and_voice_params(tom_user_and_db):
    user_id, db = tom_user_and_db

    # 1. Test paralinguistic tag conversion
    from voice.pipeline import process_dysfluency, voice_params
    text_with_tags = "Я [припускаю], що це так. Також це [встановлено] точно."
    spoken = process_dysfluency(text_with_tags)
    assert "хм... е-е... " in spoken
    assert "[встановлено]" not in spoken
    assert "[припускаю]" not in spoken

    # 2. Test voice params calculation
    # Standard state
    p_normal = {"valence": 0.5, "arousal": 0.3, "fatigue": 0.0}
    params_normal = voice_params(p_normal, "SHADOW")
    assert params_normal["stability"] == 0.60
    assert params_normal["rate"] == 1.00

    # Stressed / Crisis mode
    params_crisis = voice_params(p_normal, "CRISIS_MODE")
    assert params_crisis["stability"] == 0.85
    assert params_crisis["rate"] == 1.05

    # Tired / Fatigue state
    p_tired = {"valence": 0.3, "arousal": 0.2, "fatigue": 0.7}
    params_tired = voice_params(p_tired, "FOCUS")
    assert params_tired["stability"] == 0.80
    assert params_tired["rate"] == 0.90


@pytest.mark.asyncio
async def test_relationship_chronicle_endpoints(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db

    # Create dummy episodes, semantics and beliefs
    now = time.time()
    ep = Episode(
        session_id="session_chronicle_1", ts=now - 50, role="user",
        content="Привіт, це тест епохи.", dream_processed=1
    )
    sem = SemanticMemory(
        statement="Користувач створює тести.", topic_key="code",
        importance=0.8, created_at=now - 40
    )
    b = Belief(
        subject="user", statement="Користувач любить програмувати.",
        predicate_key="hobby", value="programming", belief_type="preference",
        confidence=0.9, log_odds=2.0, status="active", created_at=now - 30, updated_at=now - 30
    )
    db.add(ep)
    db.add(sem)
    db.add(b)
    await db.commit()

    # Create Epoch record
    from db.tom_models import Epoch
    epoch = Epoch(
        name="Епоха тестів",
        start_time=now - 100,
        end_time=now + 100,
        topic_summary=json.dumps(["code", "preference"]),
        status="active",
        created_at=now
    )
    db.add(epoch)
    await db.commit()

    # 1. Test timeline endpoint
    from api.routes_chronicle import get_timeline, rename_epoch, hide_epoch, delete_epoch, RenameEpochRequest
    # Mock authentication user
    mock_user = User(id=user_id)

    timeline = await get_timeline(me=mock_user, db=db)
    assert len(timeline) == 1
    assert timeline[0].name == "Епоха тестів"
    assert len(timeline[0].beliefs) == 1
    assert len(timeline[0].semantics) == 1
    assert "svg" in timeline[0].dream_art_svg

    # 2. Test Rename
    req = RenameEpochRequest(name="Нова назва епохи")
    rename_resp = await rename_epoch(epoch_id=epoch.id, payload=req, me=mock_user, db=db)
    assert rename_resp["status"] == "success"

    # Verify updated in DB
    res_ep = await db.execute(select(Epoch).where(Epoch.id == epoch.id))
    assert res_ep.scalar_one().name == "Нова назва епохи"

    # 3. Test Hide
    hide_resp = await hide_epoch(epoch_id=epoch.id, me=mock_user, db=db)
    assert hide_resp["status"] == "success"
    
    res_ep_hide = await db.execute(select(Epoch).where(Epoch.id == epoch.id))
    assert res_ep_hide.scalar_one().status == "hidden"

    # Restore status to active so we can delete
    epoch.status = "active"
    await db.commit()

    # 4. Test delete and cascade-deletion
    await delete_epoch(epoch_id=epoch.id, me=mock_user, db=db)
    
    # Verify epoch, episodes, beliefs, and semantics deleted
    res_ep_del = await db.execute(select(Epoch).where(Epoch.id == epoch.id))
    assert res_ep_del.scalar_one_or_none() is None

    res_episode = await db.execute(select(Episode).where(Episode.id == ep.id))
    assert res_episode.scalar_one_or_none() is None

    res_belief = await db.execute(select(Belief).where(Belief.id == b.id))
    assert res_belief.scalar_one_or_none() is None

    res_sem = await db.execute(select(SemanticMemory).where(SemanticMemory.id == sem.id))
    assert res_sem.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_dream_eligibility_gate(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db
    
    from memory.tom_dream import dream_admissible
    from core.context_engine import context_engine
    
    # 1. State GHOST -> should deny
    context_engine.set_state("GHOST")
    ok, reason = await dream_admissible(db)
    assert not ok
    assert reason == "privacy"
    
    # Reset state to SHADOW
    context_engine.set_state("SHADOW")
    
    # 2. User active -> should deny
    monkeypatch.setattr(context_engine, "get_snapshot", lambda: {
        "system": {"state": "SHADOW"},
        "history": {"last_interaction_ago_s": 100}
    })
    ok, reason = await dream_admissible(db)
    assert not ok
    assert reason == "presence"
    
    # 3. High CPU temperature -> should deny
    monkeypatch.setattr(context_engine, "get_snapshot", lambda: {
        "system": {"state": "SHADOW"},
        "history": {"last_interaction_ago_s": 999}
    })
    monkeypatch.setattr("memory.tom_dream.cpu_temperature_c", AsyncMock(return_value=90.0))
    ok, reason = await dream_admissible(db)
    assert not ok
    assert reason == "thermal"
    
    # 4. Low battery not on AC -> should deny
    monkeypatch.setattr("memory.tom_dream.cpu_temperature_c", AsyncMock(return_value=50.0))
    monkeypatch.setattr("memory.tom_dream.check_power_status", lambda: (False, 15.0))
    ok, reason = await dream_admissible(db)
    assert not ok
    assert reason == "power"
    
    # 5. Low battery ON AC -> should allow
    monkeypatch.setattr("memory.tom_dream.check_power_status", lambda: (True, 15.0))
    from db.tom_models import Episode
    db.add(Episode(session_id="s1", ts=time.time() - 5 * 3600, role="user", content="test", dream_processed=0))
    db.add(Episode(session_id="s1", ts=time.time() - 5 * 3600, role="assistant", content="test", dream_processed=0))
    db.add(Episode(session_id="s1", ts=time.time() - 5 * 3600, role="user", content="test", dream_processed=0))
    await db.commit()
    
    ok, reason = await dream_admissible(db)
    assert ok
    assert reason == "ok"


@pytest.mark.asyncio
async def test_dream_transaction_safety(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db
    
    monkeypatch.setattr("memory.tom_dream.cpu_temperature_c", AsyncMock(return_value=40.0))
    monkeypatch.setattr("memory.tom_dream.check_power_status", lambda: (True, 100.0))
    
    from core.context_engine import context_engine
    monkeypatch.setattr(context_engine, "get_snapshot", lambda: {
        "system": {"state": "SHADOW"},
        "history": {"last_interaction_ago_s": 999}
    })
    
    from db.tom_models import Episode, DreamJob, DreamMutation, SemanticMemory, Belief
    db.add(Episode(session_id="s_tx", ts=time.time(), role="user", content="Перший епізод.", dream_processed=0))
    db.add(Episode(session_id="s_tx", ts=time.time(), role="assistant", content="Відповідь.", dream_processed=0))
    db.add(Episode(session_id="s_tx", ts=time.time(), role="user", content="Другий епізод.", dream_processed=0))
    await db.commit()
    
    class FakeLLMResult:
        def __init__(self, content):
            self.content = content
            
    async def fake_dispatch(action, payload, provider_hint=None):
        msg = payload.get("user_message", "")
        if "консолідації пам'яті" in msg:
            return FakeLLMResult('[{"statement": "Користувач любить чай.", "topic_key": "preference", "importance": 0.8}]')
        elif "Theory of Mind" in msg:
            return FakeLLMResult('[{"statement": "Користувач віддає перевагу чаю перед кавою.", "belief_type": "preference", "predicate_key": "tea_preference", "value": "tea", "confidence": 0.9, "evidence_source_index": 0}]')
        elif "active_probe" in msg:
            return FakeLLMResult('[]')
        return FakeLLMResult('[]')
        
    import ai.hub
    monkeypatch.setattr(ai.hub.ai_hub, "dispatch", fake_dispatch)
    
    mock_store = AsyncMock()
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "store_fact", mock_store)
    
    gate_call_count = 0
    async def dynamic_admissible(database):
        nonlocal gate_call_count
        gate_call_count += 1
        if gate_call_count > 1:
            return False, "presence"
        return True, "ok"
        
    monkeypatch.setattr("memory.tom_dream.dream_admissible", dynamic_admissible)
    
    from memory.tom_dream import dream_reflect
    res = await dream_reflect(db, user_id)
    assert res["status"] == "aborted"
    
    res_sem = await db.execute(select(SemanticMemory))
    assert len(res_sem.scalars().all()) == 0
    res_b = await db.execute(select(Belief))
    assert len(res_b.scalars().all()) == 0
    
    res_job = await db.execute(select(DreamJob))
    jobs = res_job.scalars().all()
    assert len(jobs) == 1
    assert jobs[0].phase == "aborted"
    
    res_mut = await db.execute(select(DreamMutation))
    muts = res_mut.scalars().all()
    assert len(muts) > 0


@pytest.mark.asyncio
async def test_right_to_forget_cascade(tom_user_and_db, monkeypatch):
    user_id, db = tom_user_and_db
    
    mock_delete = AsyncMock()
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "delete_fact", mock_delete)
    
    from db.models import VaultCard
    from datetime import datetime, timezone
    card_id = str(uuid.uuid4())
    card = VaultCard(
        id=card_id,
        owner_user_id=user_id,
        kind="api_key",
        label="Test Key",
        fields_json=json.dumps({"credential": {"v": "secret", "secret": True}}),
        tags_json=json.dumps([]),
        ai_writable=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db.add(card)
    await db.commit()
    
    now = time.time()
    ep = Episode(
        session_id="s_forget", ts=now - 50, role="user",
        content=f"Мій ключ ⟦vault:{card_id}:credential⟧ збережено.",
        dream_processed=1
    )
    sem = SemanticMemory(
        statement="У користувача є секретний ключ.", topic_key="api",
        importance=0.8, created_at=now - 40, embedding_id="sem_forget_1"
    )
    b = Belief(
        subject="user", statement="Користувач має інтеграцію з сервісом.",
        predicate_key="has_api", value="true", belief_type="preference",
        confidence=0.9, log_odds=2.0, status="active", created_at=now - 30, updated_at=now - 30,
        embedding_id="belief_forget_1"
    )
    db.add(ep)
    db.add(sem)
    db.add(b)
    await db.commit()
    
    from db.tom_models import Epoch
    epoch = Epoch(
        name="Епоха забування",
        start_time=now - 100,
        end_time=now + 100,
        topic_summary=json.dumps(["api"]),
        status="active",
        created_at=now
    )
    db.add(epoch)
    await db.commit()
    
    from memory.forget_service import forget_epoch
    await forget_epoch(db, epoch.id, user_id)
    
    res_ep_del = await db.execute(select(Epoch).where(Epoch.id == epoch.id))
    assert res_ep_del.scalar_one_or_none() is None
    
    res_ep = await db.execute(select(Episode).where(Episode.id == ep.id))
    assert res_ep.scalar_one_or_none() is None
    
    res_sem = await db.execute(select(SemanticMemory).where(SemanticMemory.id == sem.id))
    assert res_sem.scalar_one_or_none() is None
    
    res_b = await db.execute(select(Belief).where(Belief.id == b.id))
    assert res_b.scalar_one_or_none() is None
    
    res_card = await db.execute(select(VaultCard).where(VaultCard.id == card_id))
    assert res_card.scalar_one_or_none() is None
    
    assert mock_delete.call_count == 2
    mock_delete.assert_any_call(user_id, "belief_forget_1")
    mock_delete.assert_any_call(user_id, "sem_forget_1")

