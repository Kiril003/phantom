# PHANTOM OS — State Machine

## Формальна FSM Визначення

```
States: { SHADOW, FOCUS, DIALOGUE, SENTINEL, GHOST, DREAM }
Initial: SHADOW
```

## Таблиця Переходів

| From | To | Trigger Condition | Priority |
|------|----|-------------------|----------|
| SHADOW | FOCUS | screen_active AND breathing_calm AND work_hours | 5 |
| SHADOW | DIALOGUE | voice_input OR touch_input OR encoder_activate | 4 |
| SHADOW | SENTINEL | other_detected AND (first_visit OR night_time) | 1 |
| SHADOW | DREAM | breathing_bpm < 14 for 10min AND is_night | 6 |
| FOCUS | DIALOGUE | voice_input OR touch_chat OR ai_wants_to_speak | 4 |
| FOCUS | SHADOW | no_interaction > 120s | 7 |
| FOCUS | SENTINEL | other_detected AND (first_visit OR night_time) | 1 |
| FOCUS | DREAM | breathing_bpm < 14 for 10min AND is_night | 6 |
| DIALOGUE | FOCUS | conversation_ended AND was_in_focus | 5 |
| DIALOGUE | SHADOW | conversation_ended AND was_NOT_in_focus | 7 |
| DIALOGUE | SENTINEL | other_detected AND threat_level > 0.7 | 1 |
| SENTINEL | SHADOW | threat_resolved OR timeout 5min | 7 |
| SENTINEL | DIALOGUE | user_acknowledges_threat | 4 |
| DREAM | SHADOW | breathing_bpm > 16 for 2min OR morning_time | 6 |
| DREAM | DIALOGUE | voice_input (whisper detection) | 4 |
| ANY | GHOST | secret_trigger (encoder_hold_3s + rgb_btn_2) | 0 |
| GHOST | SHADOW | same secret_trigger | 0 |

## Правила Пріоритетів

Priority 0 = абсолютний, виконується завжди (GHOST toggle)
Priority 1 = безпека, перериває все
Priority 2-3 = здоров'я / календар
Priority 4 = взаємодія з юзером
Priority 5-6 = автоматичні переходи
Priority 7 = idle/timeout

**Менший номер = вищий пріоритет. При конфлікті виграє нижчий.**

## Алгоритм Переходу

```python
class StateMachine:
    def evaluate(self, snapshot: ContextSnapshot) -> StateTransition | None:
        """Викликається кожні 500ms з новим snapshot."""
        
        # 1. Перевірити GHOST toggle (priority 0)
        if self._check_ghost_trigger(snapshot):
            return self._transition_ghost()
        
        # 2. Перевірити security (priority 1)  
        if self._check_threat(snapshot):
            return StateTransition(to=SENTINEL, trigger="threat_detected")
        
        # 3. Перевірити health (priority 2)
        if snapshot.body.stress_level > 0.7 and snapshot.body.breathing_bpm > 28:
            self.event_bus.emit("health_alert", snapshot)
            # не обов'язково transition, але AI пропонує паузу
        
        # 4. Зібрати всі можливі transitions з поточного стану
        candidates = self._get_candidates(self.current_state, snapshot)
        
        # 5. Відсортувати по priority, взяти перший
        if candidates:
            best = min(candidates, key=lambda t: t.priority)
            return best
        
        return None  # залишаємось в поточному стані
```

## Guard Conditions (детально)

### breathing_calm
```python
snapshot.body.breathing_bpm is not None 
and 12 <= snapshot.body.breathing_bpm <= 20
and snapshot.body.stress_level < 0.4
```

### is_night
```python
snapshot.when.hour >= 23 or snapshot.when.hour < 6
```

### other_detected  
```python
snapshot.presence.other_detected == True
and snapshot.presence.other_distance_cm is not None
and snapshot.presence.other_distance_cm < 300  # 3 метри
```

### first_visit
```python
snapshot.where.first_visit == True
or snapshot.where.place_known == False
```

### conversation_ended
```python
last_user_message_ago > 30s
and last_ai_message_ago > 30s  
and not tts_playing
and not stt_listening
```

### secret_trigger (GHOST)
```python
snapshot.encoder is not None
and snapshot.encoder.long_press == True  # 3s hold
and snapshot.buttons is not None
and snapshot.buttons.rgb_states[1] == True  # button index 1
# Обидва одночасно протягом 500ms window
```

### ai_wants_to_speak
```python
# DecisionTree вирішив що AI має ініціювати
# Priority 3-5 events що накопичились
decision_tree.has_pending_initiative() == True
```

## Поведінка По Станах

### SHADOW
- UI: тільки status bar 28px, решта темна
- Sensors: все активне, sampling normal
- AI: пасивний, не ініціює
- Voice: wake word detection only
- OLED: годинник або пусто

### FOCUS  
- UI: робочий простір + mini sidebar
- Sensors: все активне
- AI: може ініціювати priority 3-5
- Voice: wake word + keyword detection
- OLED: поточний стан / міні-інфо

### DIALOGUE
- UI: чат розгорнутий, аватар активний
- Sensors: все активне
- AI: повна взаємодія, вибирає форми відповідей
- Voice: full duplex STT + TTS
- OLED: синхронізовано з чатом

### SENTINEL
- UI: повна карта + radar card + camera
- Sensors: max sampling rate
- AI: threat assessment, рекомендації
- Voice: голосові alerts
- OLED: "⚠ ALERT" + info
- RGB: red pulsing
- Haptic: alert pattern

### GHOST
- UI: екран темний, мікро-індикатор
- Sensors: все записується, encrypted
- AI: мовчить
- Voice: recording only, no TTS
- OLED: off
- RGB: off
- ВАЖЛИВО: все пишеться в AES-256 encrypted log

### DREAM
- UI: мінімальний ambient glow (purple)
- Sensors: radar only (breathing monitoring)
- AI: whisper mode, мін. слів, ніяких питань
- Voice: whisper detection, quiet TTS
- OLED: off або dim clock
- RGB: dim purple breathing
