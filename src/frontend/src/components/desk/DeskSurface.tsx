import { Fragment, useCallback, useRef, useState } from 'react';
import { useDeskStore, MIN_FRACTION, type DeskPane } from '../../stores/deskStore';
import { Pane } from './Pane';
import { DeskWindow } from './DeskWindow';
import { useElementSize } from './useViewportSize';

const SPLIT_W = 6;

/**
 * Поверхня активного стола: ряд плиток зі сплітерами, вільні вікна
 * поверх, повноекранний пейн — над усім. Розміри — з власного виміру
 * поверхні (ResizeObserver), не з констант.
 */
export function DeskSurface() {
  const desks = useDeskStore((s) => s.desks);
  const activeDeskId = useDeskStore((s) => s.activeDeskId);
  const desk = desks.find((d) => d.id === activeDeskId) ?? desks[0];

  const { ref, width, height } = useElementSize<HTMLDivElement>();

  const tiles = desk.panes.filter((p) => p.mode === 'tile');
  const floats = desk.panes.filter((p) => p.mode === 'float');
  const fulls = desk.panes.filter((p) => p.mode === 'full');

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden" aria-label={`Стіл «${desk.name}»`}>
      {desk.panes.length === 0 && <DeskEmpty />}

      {tiles.length > 0 && width > 0 && <TileRow deskId={desk.id} tiles={tiles} width={width} />}

      {width > 0 &&
        height > 0 &&
        floats.map((pane) => (
          <DeskWindow key={pane.id} pane={pane} deskId={desk.id} bounds={{ width, height }} />
        ))}

      {fulls.map((pane) => (
        <div key={pane.id} className="absolute inset-0" style={{ zIndex: 60 + pane.z }}>
          <Pane pane={pane} deskId={desk.id} />
        </div>
      ))}
    </div>
  );
}

/** Порожній стіл каже це словом — нічого не імітує. */
function DeskEmpty() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <span
        style={{
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-ink-muted)',
        }}
      >
        Порожній стіл
      </span>
    </div>
  );
}

/**
 * Ряд плиток: ширини — з часток, нормалізованих по сумі присутніх плиток
 * (плитка, що відлетіла у вікно, чесно віддає місце). Сплітер між
 * сусідами перетягується; частки комітяться в стор на відпусканні.
 */
function TileRow({ deskId, tiles, width }: { deskId: string; tiles: DeskPane[]; width: number }) {
  const setSplit = useDeskStore((s) => s.setSplit);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const dragRef = useRef<{
    leftId: string;
    rightId: string;
    startX: number;
    leftStart: number;
    rightStart: number;
    available: number;
  } | null>(null);

  const fractions: Record<string, number> = {};
  const sum = tiles.reduce((acc, t) => acc + (draft?.[t.id] ?? t.fraction), 0) || 1;
  for (const t of tiles) fractions[t.id] = (draft?.[t.id] ?? t.fraction) / sum;

  const available = Math.max(0, width - SPLIT_W * (tiles.length - 1));

  const onSplitPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, leftId: string, rightId: string) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const left = tiles.find((t) => t.id === leftId);
      const right = tiles.find((t) => t.id === rightId);
      if (!left || !right) return;
      dragRef.current = {
        leftId,
        rightId,
        startX: e.clientX,
        leftStart: left.fraction,
        rightStart: right.fraction,
        available,
      };
    },
    [tiles, available],
  );

  const onSplitPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const total = tiles.reduce((acc, t) => acc + t.fraction, 0) || 1;
      const deltaFraction = ((e.clientX - d.startX) / Math.max(1, d.available)) * total;
      const pairSum = d.leftStart + d.rightStart;
      const minPair = Math.min(MIN_FRACTION, pairSum / 2);
      const left = Math.max(minPair, Math.min(pairSum - minPair, d.leftStart + deltaFraction));
      const right = pairSum - left;
      setDraft({ [d.leftId]: left, [d.rightId]: right });
    },
    [tiles],
  );

  const onSplitPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (draft && draft[d.leftId] !== undefined && draft[d.rightId] !== undefined) {
        setSplit(deskId, d.leftId, draft[d.leftId], d.rightId, draft[d.rightId]);
      }
      setDraft(null);
    },
    [draft, setSplit, deskId],
  );

  return (
    <div className="absolute inset-0 flex" style={{ gap: 0 }}>
      {tiles.map((pane, i) => (
        <Fragment key={pane.id}>
          <div
            className="min-w-0 min-h-0 h-full"
            style={{ width: Math.round(available * fractions[pane.id]) }}
          >
            <Pane pane={pane} deskId={deskId} />
          </div>
          {i < tiles.length - 1 && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Перетягнути межу"
              title="Перетягнути межу"
              onPointerDown={(e) => onSplitPointerDown(e, pane.id, tiles[i + 1].id)}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
              className="h-full shrink-0"
              style={{
                width: SPLIT_W,
                cursor: 'col-resize',
                touchAction: 'none',
                background: 'var(--ph-color-border)',
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
