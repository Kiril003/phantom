import React from 'react';

/**
 * К4-міст до агента f1-command-organism — файли ПРИЇХАЛИ, міст
 * перейшов з runtime-проби (@vite-ignore) на статичні lazy-імпорти:
 * тепер їх бачить і tsc, і бандлер.
 *
 * CommandBar сам дефолтить навігацію в deskStore.openPane і сам слухає
 * Ctrl+K; OrganismStrip (30px) — верхня смуга реальних пульсів, вона ж
 * заміна StatusBar на столі. Бюджет хрому: 30 + 28 (смуга столів) =
 * 58px ≤ 76px.
 */

const CommandBar = React.lazy(() => import('../command/CommandBar'));
const OrganismStrip = React.lazy(() => import('../organism/OrganismStrip'));

/** Командний рядок (Ctrl+K) — глобально в оболонці застосунку. */
export function CommandBarMount() {
  return (
    <React.Suspense fallback={null}>
      <CommandBar />
    </React.Suspense>
  );
}

/** Стрічка організму — верхня тонка смуга реальних пульсів. */
export function OrganismStripMount() {
  return (
    <React.Suspense fallback={null}>
      <OrganismStrip />
    </React.Suspense>
  );
}
