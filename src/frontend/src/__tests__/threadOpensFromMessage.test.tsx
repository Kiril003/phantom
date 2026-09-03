/**
 * Гілка відкривається з конкретного листа.
 *
 * Рівень, якого в застосунку не було: тип `Thread` існував, дороги не було.
 * Сторож б'є саме в дорогу — подія з дій над листом мусить давати гілку.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThreadPanel } from '../components/messenger/ThreadPanel';
import { useSpaceStore } from '../stores/spaceStore';

vi.mock('../utils/messengerSound', () => ({ soundFx: { playTap: () => {} } }));

const ME = 'u_me';
// Подія летить із дій над листом — поза React. Обгортка `act` потрібна,
// щоб перемалювання встигло: без неї тест міряв би СВІЙ кадр, а не панель.
const fire = (messageId: string) =>
  act(() => {
    window.dispatchEvent(new CustomEvent('phantom:open-thread', { detail: { messageId } }));
  });

beforeEach(() =>
  useSpaceStore.setState({
    spaces: [], topics: [], threads: [],
    activeSpaceId: null, activeTopicId: null, activeThreadId: null,
  }),
);

describe('гілка від листа', () => {
  it('без відкритого топіка каже, чого бракує — і нічого не вигадує', () => {
    const { container } = render(<ThreadPanel me={ME} />);
    fire('m1');
    expect(container.textContent).toContain('топік зараз не відкритий');
    // Топік за людину не створюємо.
    expect(useSpaceStore.getState().topics).toHaveLength(0);
    expect(useSpaceStore.getState().threads).toHaveLength(0);
  });

  it('у топіку подія з листа створює й відкриває гілку', () => {
    const st = useSpaceStore.getState();
    const sp = st.createSpace('П', 'blank', ME);
    const tp = st.createTopic(sp.id, 'Т', ME);
    useSpaceStore.getState().openSpace(sp.id);
    useSpaceStore.getState().openTopic(tp.id);

    render(<ThreadPanel me={ME} />);
    fire('msg_42');

    const s = useSpaceStore.getState();
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0].rootMessageId).toBe('msg_42');
    expect(s.activeThreadId).toBe(s.threads[0].id);
    expect(screen.getByTestId('thread-panel').textContent).toContain('msg_42');
  });

  it('другий дотик по тому самому листу відкриває ту саму гілку', () => {
    const st = useSpaceStore.getState();
    const sp = st.createSpace('П', 'blank', ME);
    const tp = st.createTopic(sp.id, 'Т', ME);
    useSpaceStore.getState().openSpace(sp.id);
    useSpaceStore.getState().openTopic(tp.id);

    render(<ThreadPanel me={ME} />);
    fire('msg_7');
    const first = useSpaceStore.getState().threads[0].id;
    fire('msg_7');
    expect(useSpaceStore.getState().threads).toHaveLength(1);
    expect(useSpaceStore.getState().activeThreadId).toBe(first);
  });

  it('порожня гілка каже, для чого вона, а не мовчить', () => {
    const st = useSpaceStore.getState();
    const sp = st.createSpace('П', 'blank', ME);
    const tp = st.createTopic(sp.id, 'Т', ME);
    useSpaceStore.getState().openSpace(sp.id);
    useSpaceStore.getState().openTopic(tp.id);
    render(<ThreadPanel me={ME} />);
    fire('m1');
    expect(screen.getByTestId('thread-panel').textContent).toContain('власне непрочитане');
  });

  it('панель зникає, коли гілку закрито', () => {
    const st = useSpaceStore.getState();
    const sp = st.createSpace('П', 'blank', ME);
    const tp = st.createTopic(sp.id, 'Т', ME);
    useSpaceStore.getState().openSpace(sp.id);
    useSpaceStore.getState().openTopic(tp.id);
    render(<ThreadPanel me={ME} />);
    fire('m1');
    fireEvent.click(screen.getByLabelText('Закрити гілку'));
    expect(screen.queryByTestId('thread-panel')).toBeNull();
  });
});
