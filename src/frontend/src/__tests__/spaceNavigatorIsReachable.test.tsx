/**
 * Навігація простір→топік досяжна з живого інтерфейсу.
 *
 * Кістка без дороги не рахується: `GroupTopic` уже існував у типах і не
 * вживався ніде, а дані топіків лежали засіяні й наполовину малювались —
 * відкрити топік не можна було нічим. Цей сторож стереже саме дорогу.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceNavigator } from '../components/messenger/SpaceNavigator';
import { useSpaceStore } from '../stores/spaceStore';

vi.mock('../utils/messengerSound', () => ({ soundFx: { playTap: () => {} } }));

const ME = 'u_me';
beforeEach(() =>
  useSpaceStore.setState({
    spaces: [], topics: [], threads: [],
    activeSpaceId: null, activeTopicId: null, activeThreadId: null,
  }),
);

describe('навігація просторів', () => {
  it('без просторів видно лише кнопку створення — і жодного вигаданого прикладу', () => {
    const { container } = render(<SpaceNavigator me={ME} />);
    expect(screen.getByLabelText('Створити простір')).toBeTruthy();
    expect(container.querySelectorAll('[aria-label^="Простір "]')).toHaveLength(0);
  });

  it('простір створюється з інтерфейсу й одразу відкривається', () => {
    render(<SpaceNavigator me={ME} />);
    fireEvent.click(screen.getByLabelText('Створити простір'));
    fireEvent.change(screen.getByLabelText('Назва простору'), { target: { value: 'Бригада' } });
    fireEvent.click(screen.getByText('Створити'));

    const st = useSpaceStore.getState();
    expect(st.spaces).toHaveLength(1);
    expect(st.activeSpaceId).toBe(st.spaces[0].id);
    expect(screen.getByLabelText('Простір Бригада')).toBeTruthy();
  });

  it('порожній простір каже правду, а не малює приклади топіків', () => {
    const sp = useSpaceStore.getState().createSpace('Бригада', 'blank', ME);
    useSpaceStore.getState().openSpace(sp.id);
    const { container } = render(<SpaceNavigator me={ME} />);
    expect(container.textContent).toContain('Топіків ще немає');
  });

  it('топік створюється з поля і відкривається — це та сама дорога', () => {
    const sp = useSpaceStore.getState().createSpace('Бригада', 'work', ME);
    useSpaceStore.getState().openSpace(sp.id);
    render(<SpaceNavigator me={ME} />);

    const field = screen.getByLabelText('Новий топік');
    fireEvent.change(field, { target: { value: 'Виходи' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    const st = useSpaceStore.getState();
    expect(st.topics.map((t) => t.title)).toEqual(['Виходи']);
    expect(st.activeTopicId).toBe(st.topics[0].id);
  });

  it('пресет показує, що саме увімкне — вибір не читається як незворотний', () => {
    render(<SpaceNavigator me={ME} />);
    fireEvent.click(screen.getByLabelText('Створити простір'));
    fireEvent.click(screen.getByText('Робочий'));
    expect(screen.getByText(/Змінюється будь-коли/)).toBeTruthy();
  });

  it('інструменти простору вмикаються кліками — і їх видно в шапці', () => {
    const sp = useSpaceStore.getState().createSpace('Бригада', 'blank', ME);
    useSpaceStore.getState().openSpace(sp.id);
    const { container } = render(<SpaceNavigator me={ME} />);

    expect(container.textContent).toContain('без інструментів');
    fireEvent.click(screen.getByLabelText('Інструменти простору'));
    fireEvent.click(screen.getByLabelText('Інструмент Дошка'));

    expect(useSpaceStore.getState().spaces[0].tools).toContain('kanban');
    expect(container.textContent).toContain('Дошка');
  });

  it('каталог пропонує лише те, що працює — жодної замкненої модалки', async () => {
    const { TOOL_CATALOGUE } = await import('../components/messenger/toolCatalogue');
    const hidden = (
      await import('../components/messenger/modals/hiddenModals')
    ).HIDDEN_UNTIL_WIRED;
    for (const t of TOOL_CATALOGUE) {
      expect(hidden.has(t.id), `інструмент «${t.label}» веде в замкнений екран`).toBe(false);
    }
  });
});
