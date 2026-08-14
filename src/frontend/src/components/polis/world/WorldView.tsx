/** Світ — місто зверху, будівля зсередини. Клік по району спускає всередину,
 * «до міста» піднімає назад. Місто 2D лишається головним видом, тому three.js
 * тягнеться лише коли реально заходиш у будівлю. */
import { useState, useCallback, lazy, Suspense } from 'react';
import { districtOf } from '../cityMap';

const PolisCity3D = lazy(() =>
  import('./PolisCity3D').then((m) => ({ default: m.PolisCity3D })),
);
const DistrictInterior = lazy(() =>
  import('./DistrictInterior').then((m) => ({ default: m.DistrictInterior })),
);

/** Площа й електростанція не мають інтер'єру — усе про них видно згори. */
const NO_INTERIOR = new Set(['power', 'plaza']);

function Loading() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <span className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
        відчиняємо двері…
      </span>
    </div>
  );
}

export function WorldView() {
  const [inside, setInside] = useState<string | null>(null);

  const enter = useCallback((id: string) => {
    if (!NO_INTERIOR.has(id)) setInside(id);
  }, []);

  return (
    <Suspense fallback={<Loading />}>
      {inside ? (
        <DistrictInterior
          districtId={inside}
          label={districtOf(inside).label}
          onExit={() => setInside(null)}
        />
      ) : (
        <PolisCity3D onEnterDistrict={enter} />
      )}
    </Suspense>
  );
}
