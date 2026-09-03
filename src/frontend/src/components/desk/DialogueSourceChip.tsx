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

/**
 * Де живе провайдер — властивість провайдера, не стан машини.
 *
 * Тут стояло «хмара · ключ», і це виявилось твердженням, а не властивістю:
 * на стенді 03.09.2026 ключа Gemini НЕМАЄ (ані `.env`, ані змінної в
 * середовищі бекенда — перевірено за іменами, не за значеннями), а
 * `/health` усе одно віддає `ai_active: "gemini"`. Тобто чіп називав
 * провайдера, який відповісти не може, — рівно той клас, що ми ловили
 * сьогодні в «Поруч» і в геокодері, тільки вже у власному коді.
 *
 * Слово «ключ» знято до того часу, поки ядро не скаже ПРИДАТНІСТЬ
 * (`ai_ready` + причина). Доти чіп каже лише те, що знає: який провайдер
 * обрано в налаштуваннях і де такий провайдер живе взагалі.
 */
const WHERE: Record<string, string> = {
  ollama: 'локально',
  llamacpp: 'локально',
  gemini: 'хмара',
  openai: 'хмара',
  anthropic: 'хмара',
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

/** Провайдер словом: «Gemini · хмара»; невідомий — лише на імʼя. */
function providerPhrase(id: string): string {
  const where = WHERE[id.toLowerCase()];
  const word = providerWord(id);
  return where ? `${word} · ${where}` : word;
}

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
      const fallback = (pulse.data.ai_fallback || '').trim();
      const ready = pulse.data.ai_ready;
      const reason = (pulse.data.ai_ready_reason || '').trim();
      const fbReady = pulse.data.ai_fallback_ready;
      const fbReason = (pulse.data.ai_fallback_reason || '').trim();
      const fbLoaded = pulse.data.ai_fallback_model_loaded;

      // Старе ядро без полів придатності: кажемо лише те, що знаємо —
      // хто обраний, — і в підказці зізнаємось, що звʼязку не перевіряли.
      if (ready === undefined) {
        setState({
          kind: 'named',
          word: providerPhrase(active),
          title: `ai_active: ${active}${fallback ? ` · запасний: ${fallback}` : ''} — налаштування (GET /health), не перевірка звʼязку`,
        });
        return;
      }

      // Стан не прочитано — це НЕ «непридатний». Мовчання не є вироком.
      if (ready === null) {
        setState({
          kind: 'named',
          word: `${providerPhrase(active)} · стан невідомий`,
          title: reason || 'GET /health: стан придатності не прочитано',
        });
        return;
      }

      if (ready) {
        setState({
          kind: 'named',
          word: providerPhrase(active),
          title: `ai_ready: true — ${active}${fallback ? ` · запасний: ${fallback}` : ''} (GET /health)`,
        });
        return;
      }

      // Обраний не відповість. Далі важить рівно одне: чи є хто інший.
      if (fbReady && fallback) {
        // «модель ще не в памʼяті» — з поля ядра, не з нашої здогадки:
        // перший лист на холодну підіймає гігабайти й коштує десятки секунд.
        const cold = fbLoaded === false ? ' · модель ще не в памʼяті' : '';
        setState({
          kind: 'named',
          word: `${providerWord(active)} не відповість → ${providerPhrase(fallback)}${cold}`,
          title: reason || `ai_ready: false для ${active} (GET /health)`,
        });
        return;
      }

      setState({
        kind: 'named',
        word: 'нікому відповісти',
        title: [reason, fbReason].filter(Boolean).join(' · ') ||
          `ai_ready: false, запасний теж (GET /health)`,
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
