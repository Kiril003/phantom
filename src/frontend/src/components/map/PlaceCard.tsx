import { Bookmark, Loader2, Navigation, X } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';

/** Клас точки з тайла — службове слово. Людині показуємо людське. */
const CLASS_UA: Record<string, string> = {
  restaurant: 'ресторан', fast_food: 'їжа навинос', cafe: 'кав’ярня', bar: 'бар',
  beer: 'пивна', ice_cream: 'морозиво', bakery: 'пекарня', sushi: 'суші',
  shop: 'магазин', grocery: 'продукти', clothing_store: 'одяг', alcohol_shop: 'алкоголь',
  butcher: 'м’ясо', florist: 'квіти', furniture: 'меблі', gift: 'подарунки',
  hairdresser: 'перукарня', laundry: 'пральня', music: 'музика', suitcase: 'валізи',
  car: 'авто', bicycle: 'велосипеди', bank: 'банк',
  bus: 'зупинка', railway: 'залізниця', aerialway: 'підйомник', airport: 'аеропорт',
  ferry_terminal: 'порт', harbor: 'гавань', fuel: 'заправка', parking: 'парковка',
  hospital: 'лікарня', pharmacy: 'аптека', doctors: 'лікар', dentist: 'стоматолог',
  veterinary: 'ветеринар',
  town_hall: 'мерія', police: 'поліція', fire_station: 'пожежні', post: 'пошта',
  embassy: 'посольство', prison: 'тюрма', school: 'школа', college: 'коледж',
  library: 'бібліотека', place_of_worship: 'храм',
  park: 'парк', garden: 'сад', playground: 'майданчик', pitch: 'спортмайданчик',
  golf: 'гольф', stadium: 'стадіон', swimming: 'басейн', tennis: 'теніс',
  campsite: 'кемпінг', picnic_site: 'пікнік', museum: 'музей', art_gallery: 'галерея',
  theatre: 'театр', cinema: 'кіно', attraction: 'визначне місце', monument: 'пам’ятник',
  castle: 'замок', zoo: 'зоопарк', aquarium: 'океанаріум', lodging: 'готель',
  cemetery: 'цвинтар', toilets: 'вбиральня', drinking_water: 'питна вода',
  information: 'інформація', shelter: 'укриття',
};

export interface TappedPlace {
  name: string;
  cls: string;
  lon: number;
  lat: number;
  /** Відстань у метрах — лише коли ми справді знаємо, звідки міряти. */
  distanceM: number | null;
}

function distanceWord(m: number): string {
  return m < 950 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`;
}

/**
 * Картка місця, на яке тапнули.
 *
 * Мапа малювала тисячі точок міста і жодна з них не відповідала на дотик —
 * це й читалось як «кнопки нічого не роблять». Тепер точка веде до дії:
 * маршрут туди або збереження в свої місця.
 */
export function PlaceCard({
  place,
  onClose,
  origin,
}: {
  place: TappedPlace | null;
  onClose: () => void;
  /** Звідки рахувати маршрут, коли супутників немає. */
  origin: { lat: number; lon: number; label: string } | null;
}) {
  const routeToPoint = useMapStore((s) => s.routeToPoint);
  const routing = useMapStore((s) => s.routing);
  const routeError = useMapStore((s) => s.routeError);
  const savePOI = useMapStore((s) => s.savePOI);
  const setToast = useMapStore((s) => s.setToast);

  if (!place) return null;

  const kind = CLASS_UA[place.cls] ?? 'місце';

  return (
    <aside
      role="dialog"
      aria-label={`Місце: ${place.name || kind}`}
      className="glass-elevated pointer-events-auto absolute bottom-[84px] left-1/2 z-[45] w-[320px] -translate-x-1/2 rounded-2xl p-3 shadow-2xl"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display truncate text-[15px] font-bold text-[color:var(--ink-primary)]">
            {place.name || kind}
          </h3>
          <p className="mt-0.5 text-[11px] text-[color:var(--ink-muted)]">
            {place.name ? kind : 'без назви'}
            {place.distanceM != null && ` · ${distanceWord(place.distanceM)} звідси`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрити"
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[color:var(--ink-muted)] hover:bg-black/5"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      {routeError && (
        <p role="alert" className="mt-2 text-[11px] leading-tight text-rose-600">
          {routeError}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={routing}
          onClick={() =>
            void routeToPoint(
              { lat: place.lat, lon: place.lon, label: place.name || kind },
              origin ?? undefined,
            )
          }
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 text-[12px] font-bold text-[color:var(--primary-shadow,#5c3d05)] transition-all active:scale-95 disabled:opacity-40"
        >
          {routing ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
          {routing ? 'Прокладаю' : 'Маршрут сюди'}
        </button>
        <button
          type="button"
          aria-label="Зберегти місце"
          onClick={async () => {
            const saved = await savePOI({
              lat: place.lat, lon: place.lon,
              name: place.name || kind,
              category: 'saved', notes: '', icon: '📍', is_secret: false,
            });
            setToast(saved ? `Збережено: ${saved.name}` : 'Не вдалося зберегти');
          }}
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-black/10 text-[color:var(--ink-secondary)] transition-all active:scale-95 hover:bg-black/5"
        >
          <Bookmark size={16} strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}
