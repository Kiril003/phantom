/**
 * Бекенд перестав вигадувати висоту і тепер відмовляє 503-ю, поки DEM не
 * встановлено. Панель мусила відмову ПОКАЗАТИ: у старому вигляді вона ловила
 * помилку в `console.error`, лишала `profile` порожнім — і все одно малювала
 * плитки «Мін. висота 0 м» / «Макс. висота 0 м» гарною типографікою. Нуль на
 * місці невідомої висоти — та сама неправда, тільки тихіша.
 *
 * Тести читають те, що бачить оператор, а не стан компонента.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PATH: [number, number][] = [
  [50.45, 30.52],
  [50.46, 30.54],
];

const REFUSAL = {
  detail: 'Даних про висоту немає: DEM не встановлено / No elevation data: DEM not installed',
};

let fetchSpy: ReturnType<typeof vi.fn>;

function stubFetch(status: number, payload: unknown) {
  fetchSpy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchSpy);
}

beforeEach(() => {
  localStorage.setItem('phantom_token', 'test-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function openElevation() {
  const { AnalysisPanel } = await import('../components/map/panels/AnalysisPanel');
  render(<AnalysisPanel open onClose={() => {}} selectedPath={PATH} />);
  fireEvent.click(screen.getByRole('button', { name: /Рельєф/ }));
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
}

describe('профіль висот — коли бекенд відмовляє', () => {
  it('панель пояснює причину, а не мовчить', async () => {
    stubFetch(503, REFUSAL);
    await openElevation();

    expect(await screen.findByText('Даних про висоту немає')).toBeTruthy();
    expect(screen.getByText(/DEM не встановлено/)).toBeTruthy();
  });

  it('плитки мін/макс не показують нуль замість невідомої висоти', async () => {
    stubFetch(503, REFUSAL);
    await openElevation();

    await screen.findByText('Даних про висоту немає');
    expect(screen.queryByText('Мін. висота')).toBeNull();
    expect(screen.queryByText('Макс. висота')).toBeNull();
    expect(screen.queryByText('0 м')).toBeNull();
  });

  it('інша помилка називає себе, а не вдає відсутній DEM', async () => {
    stubFetch(500, { detail: 'Сервер упав / Server error' });
    await openElevation();

    expect(await screen.findByText(/Не вдалося отримати профіль/)).toBeTruthy();
    expect(screen.queryByText(/DEM не встановлено/)).toBeNull();
  });

  it('коли дані є — малює їх, а не відмову', async () => {
    stubFetch(200, {
      profile: [
        { distance_m: 0, elevation_m: 180 },
        { distance_m: 1200, elevation_m: 214 },
      ],
    });
    await openElevation();

    expect(await screen.findByText('180 м')).toBeTruthy();
    expect(screen.getByText('214 м')).toBeTruthy();
    expect(screen.queryByText('Даних про висоту немає')).toBeNull();
  });
});
