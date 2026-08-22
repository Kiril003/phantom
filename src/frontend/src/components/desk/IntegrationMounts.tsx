import React from 'react';

/**
 * К4-міст до агента f1-command-organism: CommandBar (Ctrl+K, глобально)
 * і OrganismStrip (верхня смуга пульсів) пише він, у своїх директоріях
 * components/command/** і components/organism/**.
 *
 * Файлів на момент цього комміту в дереві НЕМА — тож import іде повз
 * статичний аналіз (через new URL + @vite-ignore): щойно файли
 * з'являться, перезавантаження стенда їх підхопить; поки нема — чесний
 * null, жодного макета замість реальних пульсів.
 *
 * TODO(f1-command-organism): коли CommandBar.tsx і OrganismStrip.tsx
 * приїдуть — замінити на статичні lazy-імпорти окремим коммітом і
 * вирішити з ними бюджет хрому (OrganismStrip + StatusBar + смуга
 * столів разом не мають перевищити 76px).
 */

type AnyModule = Record<string, unknown>;

function pickComponent(m: AnyModule, named: string[]): React.ComponentType {
  for (const key of ['default', ...named]) {
    const v = m[key];
    if (typeof v === 'function') return v as React.ComponentType;
  }
  return () => null;
}

function optionalComponent(relPath: string, named: string[]): React.LazyExoticComponent<React.ComponentType> {
  return React.lazy(() =>
    import(/* @vite-ignore */ new URL(relPath, import.meta.url).href).then(
      (m: AnyModule) => ({ default: pickComponent(m, named) }),
      () => ({ default: () => null }),
    ),
  );
}

const CommandBar = optionalComponent('../command/CommandBar.tsx', ['CommandBar']);
const OrganismStrip = optionalComponent('../organism/OrganismStrip.tsx', ['OrganismStrip']);

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
