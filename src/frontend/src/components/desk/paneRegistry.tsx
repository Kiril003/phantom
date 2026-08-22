import React, { type ComponentType, type LazyExoticComponent } from 'react';
import type { PaneKind } from '../../stores/deskStore';

/**
 * Реєстр пейнів: слово-назва, чіп джерела, вміст.
 *
 * Чіп джерела називає, ЗВІДКИ вміст пейна — не вигадуючи стану. Content
 * === null означає чесне «порожньо» словом. Вміст — наявні поверхні,
 * лише обгорнуті: нутрощі мапи/діалогу/кузні не переписуються.
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
    Content: React.lazy(() => import('../../layouts/DialogueLayout')),
  },
  company: {
    kind: 'company',
    title: 'Компанія',
    source: 'агенти',
    Content: React.lazy(() => import('../../layouts/AgentFoundryLayout')),
  },
  analytics: {
    kind: 'analytics',
    title: 'Аналітика',
    source: 'ядро',
    Content: React.lazy(() => import('../../pages/Dashboard/AnalyticsOverview')),
  },
  settings: {
    kind: 'settings',
    title: 'Налаштування',
    source: 'цей вузол',
    Content: React.lazy(() => import('../../components/settings/SettingsPanel')),
  },
};
