import { useEffect, useState } from 'react';
import { fetchHealth } from '../../services/organismApi';

/**
 * Чіп джерела пейна ДІАЛОГ: ХТО саме зараз відповідає.
 *
 * Стояло слово «ядро» — літерал, однаковий і для локального Ollama, і для
 * хмарного Gemini за ключем. Для продукту, який забороняє твердження без
 * джерела, це найгірший різновид мовчання: оператор не бачить ні якості
 * (7B на ноуті проти хмарної моделі), ні ціни приватності (лист, що
 * виходить із машини, проти листа, що не виходить). Знайдено сесією
 * «Система» на склі 03.09.2026, рішення штабу того ж дня.
 *
 * Правило те саме, що в кокпіті: **слово — на скло, ідентифікатор — у
 * підказку**. Джерело правди — `GET /health` (`ai_active`/`ai_fallback`),
 * не літерал у коді.
 *
 * Чому «локально»/«хмара» взято з таблиці, а не вигадано: це властивість
 * САМОГО провайдера, а не здогад про цю машину. Ollama — локальний
 * рантайм, Gemini — хмарний API, що вимагає ключа. Провайдера, якого в
 * таблиці немає, називаємо на ім'я без жодного твердження про місце.
 */

/** Де живе провайдер — властивість провайдера, не стан машини. */
const WHERE: Record<string, string> = {
  ollama: 'локально',
  llamacpp: 'локально',
  gemini: 'хмара · ключ',
  openai: 'хмара · ключ',
  anthropic: 'хмара · ключ',
};

/** «gemini» → «Gemini»; ідентифікатор лишається в підказці як є. */
function providerWord(id: string): string {
  if (!id) return '';
  return id.charAt(0).toUpperCase() + id.slice(1);
}

type State =
  | { kind: 'asking' }
  | { kind: 'silent' }
  | { kind: 'none' }
  | { kind: 'named'; word: string; title: string };

export function DialogueSourceChip(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'asking' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const pulse = await fetchHealth();
      if (!alive) return;
      if (!pulse.ok) {
        // Мовчання ядра — не твердження про налаштування. «Модель не
        // обрано» тут було б брехнею: ми просто не питали успішно.
        setState({ kind: 'silent' });
        return;
      }
      const active = (pulse.data.ai_active || '').trim();
      if (!active) {
        setState({ kind: 'none' });
        return;
      }
      const where = WHERE[active.toLowerCase()];
      const fallback = (pulse.data.ai_fallback || '').trim();
      setState({
        kind: 'named',
        word: where ? `${providerWord(active)} · ${where}` : providerWord(active),
        title: fallback
          ? `ai_active: ${active} · запасний: ${fallback} (GET /health)`
          : `ai_active: ${active} (GET /health)`,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const word =
    state.kind === 'named'
      ? state.word
      : state.kind === 'none'
        ? 'модель не обрано'
        : state.kind === 'silent'
          ? 'ядро не відповіло'
          : 'питаю ядро…';

  const title =
    state.kind === 'named'
      ? state.title
      : state.kind === 'none'
        ? 'GET /health: ai_active порожній'
        : state.kind === 'silent'
          ? 'GET /health не відповів'
          : 'GET /health — запит у дорозі';

  return (
    <span data-testid="dialogue-source-chip" title={title}>
      {word}
    </span>
  );
}
