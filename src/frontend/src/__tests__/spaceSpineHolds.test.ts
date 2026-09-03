/**
 * Хребет: простір → топік → гілка.
 *
 * Власник: «все напхано і не продумано» — 55 модалок збоку до чату замість
 * глибини. Хребет заміняє склад: інструмент стає тим, що простір увімкнув.
 *
 * Тут перевіряється сама механіка, не вигляд.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSpaceStore, PRESET_TOOLS } from '../stores/spaceStore';

const ME = 'u_me';
const reset = () =>
  useSpaceStore.setState({
    spaces: [], topics: [], threads: [],
    activeSpaceId: null, activeTopicId: null, activeThreadId: null,
  });

beforeEach(reset);

describe('хребет месенджера', () => {
  it('порожньо на старті — жодного засіяного простору', () => {
    const s = useSpaceStore.getState();
    expect(s.spaces).toHaveLength(0);
    expect(s.topics).toHaveLength(0);
  });

  it('пресет лише обирає початковий набір інструментів, а не тип', () => {
    const { createSpace } = useSpaceStore.getState();
    const work = createSpace('Робота', 'work', ME);
    const study = createSpace('Навчання', 'study', ME);
    expect(work.tools).toEqual(PRESET_TOOLS.work);
    expect(study.tools).toEqual(PRESET_TOOLS.study);
    // Обидва — той самий Space; різниця лише в переліку.
    expect(typeof work.personal).toBe('boolean');
    expect(work.preset).not.toBe(study.preset);
  });

  it('нотатки — це простір з одним учасником, а не окрема сутність', () => {
    const notes = useSpaceStore.getState().createSpace('Нотатки', 'notes', ME);
    expect(notes.personal).toBe(true);
    expect(notes.members).toHaveLength(1);
    expect(notes.members[0].role).toBe('owner');
  });

  it('гілка від одного листа буває одна', () => {
    const st = useSpaceStore.getState();
    const sp = st.createSpace('П', 'blank', ME);
    const tp = st.createTopic(sp.id, 'Т', ME);
    const a = useSpaceStore.getState().createThread(tp.id, 'msg_1', ME);
    const b = useSpaceStore.getState().createThread(tp.id, 'msg_1', ME);
    expect(b.id).toBe(a.id);
    expect(useSpaceStore.getState().threads).toHaveLength(1);
  });

  it('відкриття рівня скидає нижчі — не можна лишитись у чужій гілці', () => {
    const st = useSpaceStore.getState();
    const sp1 = st.createSpace('Перший', 'blank', ME);
    const tp = st.createTopic(sp1.id, 'Т', ME);
    const th = useSpaceStore.getState().createThread(tp.id, 'm1', ME);
    const s = useSpaceStore.getState();
    s.openSpace(sp1.id); s.openTopic(tp.id); s.openThread(th.id);
    expect(useSpaceStore.getState().activeThreadId).toBe(th.id);

    const sp2 = useSpaceStore.getState().createSpace('Другий', 'blank', ME);
    useSpaceStore.getState().openSpace(sp2.id);
    const after = useSpaceStore.getState();
    expect(after.activeTopicId).toBeNull();
    expect(after.activeThreadId).toBeNull();
  });

  it('назад іде по одному рівню до списку', () => {
    const st = useSpaceStore.getState();
    const sp = st.createSpace('П', 'blank', ME);
    const tp = st.createTopic(sp.id, 'Т', ME);
    const th = useSpaceStore.getState().createThread(tp.id, 'm1', ME);
    const s = useSpaceStore.getState();
    s.openSpace(sp.id); s.openTopic(tp.id); s.openThread(th.id);

    useSpaceStore.getState().goBack();
    expect(useSpaceStore.getState().activeThreadId).toBeNull();
    expect(useSpaceStore.getState().activeTopicId).toBe(tp.id);
    useSpaceStore.getState().goBack();
    expect(useSpaceStore.getState().activeTopicId).toBeNull();
    expect(useSpaceStore.getState().activeSpaceId).toBe(sp.id);
    useSpaceStore.getState().goBack();
    expect(useSpaceStore.getState().activeSpaceId).toBeNull();
  });

  it('інструмент вмикається й вимикається в межах простору', () => {
    const sp = useSpaceStore.getState().createSpace('П', 'blank', ME);
    expect(sp.tools).toHaveLength(0);
    useSpaceStore.getState().toggleTool(sp.id, 'tasks');
    expect(useSpaceStore.getState().spaces[0].tools).toContain('tasks');
    useSpaceStore.getState().toggleTool(sp.id, 'tasks');
    expect(useSpaceStore.getState().spaces[0].tools).not.toContain('tasks');
  });

  it('топіки простору впорядковані й не змішуються між просторами', () => {
    const st = useSpaceStore.getState();
    const a = st.createSpace('A', 'blank', ME);
    const b = st.createSpace('B', 'blank', ME);
    useSpaceStore.getState().createTopic(a.id, 'a1', ME);
    useSpaceStore.getState().createTopic(b.id, 'b1', ME);
    useSpaceStore.getState().createTopic(a.id, 'a2', ME);
    const ta = useSpaceStore.getState().topicsOf(a.id);
    expect(ta.map((t) => t.title)).toEqual(['a1', 'a2']);
    expect(useSpaceStore.getState().topicsOf(b.id)).toHaveLength(1);
  });
});
