/**
 * Мовчання джерела — не відповідь.
 *
 * 03.09.2026, лог ядра поруч із кожним запитом: `Overpass query failed: All
 * connection attempts failed`, а маршрут `/map/nearby` віддавав **200** і
 * `{"remembered":[],"osm":[],"pois":[]}`. Скло не мало як відрізнити «поруч
 * нічого немає» від «не змогли спитати» — і малювало «Околиці · даних
 * немає», тобто стверджувало факт про світ, маючи на руках мережеву
 * відмову.
 *
 * Те саме в геокодері, і там дорожче: людина ввела адресу, прочитала
 * «нічого не знайдено» — і починає діяти на цій підставі (перевіряє
 * написання, скорочує запит, пробує іншу вулицю). Неправда про джерело
 * перетворюється на змарнований людський час.
 *
 * Бекенд тепер називає стан (`osm_status`, `status`: ok | unreachable |
 * disabled — Сесія 5, b7ef9ee і f9efe3f). Ці сторожі тримають фронтову
 * половину: слово «немає» дозволене ЛИШЕ при 'ok'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NearbyPanel } from '../components/map/NearbyPanel';
import { SearchResultsPanel } from '../components/map/panels/SearchResultsPanel';

const EMPTY = { remembered: [], osm: [], pois: [] };

vi.mock('../services/api', () => ({
  mapApi: { getNearby: vi.fn() },
}));

import { mapApi } from '../services/api';

const getNearby = mapApi.getNearby as unknown as ReturnType<typeof vi.fn>;

describe('«Поруч»: порожньо ≠ немає', () => {
  beforeEach(() => getNearby.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("джерело не відповіло → так і сказано, а не «даних немає»", async () => {
    getNearby.mockResolvedValue({
      ...EMPTY,
      osm_status: 'unreachable',
      osm_detail: 'ConnectionError: All connection attempts failed',
    });

    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);

    await waitFor(() =>
      expect(screen.getByTestId('nearby-source-silent')).toBeTruthy(),
    );
    expect(screen.getByText(/Джерело обʼєктів не відповіло/)).toBeTruthy();
    expect(screen.queryByText(/даних немає/i)).toBeNull();
    // Причина — у підказці, не в написі.
    expect(screen.getByTestId('nearby-source-silent').getAttribute('title')).toContain(
      'ConnectionError',
    );
  });

  it("вимкнене джерело — інша порада, ніж мертва мережа", async () => {
    getNearby.mockResolvedValue({ ...EMPTY, osm_status: 'disabled', osm_detail: null });

    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);

    await waitFor(() =>
      expect(screen.getByText(/Джерело обʼєктів вимкнено/)).toBeTruthy(),
    );
    expect(screen.queryByText(/не відповіло/)).toBeNull();
  });

  it("джерело відповіло й поруч справді порожньо → «даних немає» дозволено", async () => {
    getNearby.mockResolvedValue({ ...EMPTY, osm_status: 'ok', osm_detail: null });

    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);

    await waitFor(() => expect(screen.getByText(/даних немає/i)).toBeTruthy());
    expect(screen.queryByTestId('nearby-source-silent')).toBeNull();
  });

  it("старий бекенд без поля статусу читається як 'ok' — сумісність", async () => {
    getNearby.mockResolvedValue({ ...EMPTY });

    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);

    await waitFor(() => expect(screen.getByText(/даних немає/i)).toBeTruthy());
  });
});

describe('пошук місця: порожньо ≠ не знайдено', () => {
  it('геокодер не відповів → «не змогли спитати», не «нічого не знайдено»', () => {
    render(
      <SearchResultsPanel
        open
        onClose={() => {}}
        results={EMPTY}
        sourceStatus="unreachable"
        sourceDetail="ConnectionError: nominatim"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByTestId('search-source-silent')).toBeTruthy();
    expect(screen.getByText(/Не змогли спитати/)).toBeTruthy();
    expect(screen.queryByText(/Нічого не знайдено/)).toBeNull();
  });

  it('геокодер відповів і справді нічого не знайшов → так і сказано', () => {
    render(
      <SearchResultsPanel
        open
        onClose={() => {}}
        results={EMPTY}
        sourceStatus="ok"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText(/Нічого не знайдено/)).toBeTruthy();
    expect(screen.queryByTestId('search-source-silent')).toBeNull();
  });
});
