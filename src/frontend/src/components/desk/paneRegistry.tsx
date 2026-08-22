import React, { type ComponentType, type LazyExoticComponent } from 'react';
import type { PaneKind } from '../../stores/deskStore';

/**
 * Реєстр пейнів: слово-назва, чіп джерела, вміст.
 *
 * Чіп джерела називає, ЗВІДКИ вміст пейна — не вигадуючи стану. Content
 * === null означає чесне «порожньо»: пейн існує в каркасі, вміст ще не
 * під'єднано (К3 — решта). Вміст — наявні поверхні, лише обгорнуті:
 * нутрощі мапи/діалогу не переписуються.
 */
export interface PaneDef {
  kind: PaneKind;
  /** Слово-назва пейна в хедері. */
  title: string;
  /** Чіп джерела: звідки живе вміст. */
  source: string;
  Content: LazyExoticComponent<ComponentType> | null;
}

export const PANE_REGISTRY: Record<PaneKind, PaneDef> = {
  map: {
    kind: 'map',
    title: 'Мапа',
    source: 'geo-стек',
    Content: React.lazy(() => import('../../layouts/MapLayout')),
  },
  dialogue: {
    kind: 'dialogue',
    title: 'Діалог',
    source: 'ядро',
    Content: null,
  },
  company: {
    kind: 'company',
    title: 'Компанія',
    source: 'агенти',
    Content: null,
  },
  analytics: {
    kind: 'analytics',
    title: 'Аналітика',
    source: 'ядро',
    Content: null,
  },
  settings: {
    kind: 'settings',
    title: 'Налаштування',
    source: 'цей вузол',
    Content: null,
  },
};
