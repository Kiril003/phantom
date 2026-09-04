import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchHealth } from '../../services/organismApi';

/**
 * «Піднімаю мозок» — ціна першого листа, сказана ДО того, як людина його
 * напише.
 *
 * Виміряно сесією «Система» живим листом на вузлі d420789:
 *   холодна відповідь — **21,6 с**, з них **21,3 с** підняття
 *   `qwen2.5:7b` (4,7 ГБ) у памʼять і лише 0,5 с сама відповідь;
 *   гаряча — **833 мс**.
 * Тобто різниця не в моделі й не в мережі, а рівно в тому, чи лежить
 * модель у памʼяті. На склі про це не було ні слова: людина писала лист і
 * двадцять секунд дивилась у тишу, читаючи її як «завис».
 *
 * Показуємо ЛИШЕ коли ядро каже, що моделі в памʼяті немає
 * (`ai_fallback_model_loaded === false` у `GET /health` — воно бере це з
 * `api/ps`, тобто знає точно). Щойно модель піднялась — напис зникає сам,
 * бо наступне читання `/health` каже `true`. Ніякого таймера й ніякого
 * прогрес-бара: ми не знаємо, скільки лишилось, а вигадувати не будемо.
 */
export function ColdModelNotice({ pollMs = 20000 }: { pollMs?: number }): JSX.Element | null {
  const [cold, setCold] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const pulse = await fetchHealth();
      if (!alive) return;
      if (!pulse.ok) return; // мовчання ядра — не привід щось стверджувати
      const d = pulse.data;
      // Напис доречний лише тоді, коли відповідатиме САМЕ локальна модель:
      // або основний провайдер локальний, або основний не відповість і
      // черга переходить до запасного.
      const fallbackAnswers = d.ai_ready === false && d.ai_fallback_ready === true;
      setCold(Boolean(fallbackAnswers && d.ai_fallback_model_loaded === false));
    };
    void read();
    const id = setInterval(() => void read(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  if (!cold) return null;

  return (
    <div
      data-testid="cold-model-notice"
      title="Модель ще не в памʼяті: перший лист підіймає 4,7 ГБ. Виміряно: холодна відповідь 21,6 с, з них 21,3 с — саме підняття; далі близько 0,8 с."
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '0 12px 6px',
        padding: '5px 10px',
        borderRadius: 999,
        border: '1px solid rgba(244,175,37,0.30)',
        background: 'rgba(244,175,37,0.08)',
        fontSize: 10.5,
        color: 'var(--ink-secondary)',
      }}
    >
      <Loader2
        size={12}
        strokeWidth={1.75}
        className="animate-spin"
        style={{ color: '#b07a10', flexShrink: 0 }}
        aria-hidden
      />
      <span>піднімаю мозок · зазвичай до пів хвилини</span>
    </div>
  );
}
