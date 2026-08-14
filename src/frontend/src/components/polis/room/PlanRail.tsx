/** План місії і вибраний вузол. Тут живуть матеріали — під тим, хто їх зробив,
 * бо файл без походження це просто ім'я у списку. Тут же те, чого раніше не
 * було видно ніде: чому вузол стоїть, скільки коштував, чим зірвався. */
import { useEffect, useRef } from 'react';
import { FolderOpen } from 'lucide-react';
import { usePolisStore } from '../../../stores/polisStore';
import {
  buildPlan, humanMinutes, NODE_LABEL, NODE_VAR, type PlanRow,
} from './missionView';

function kb(size: number): string {
  return size < 1024 ? `${size} Б` : `${(size / 1024).toFixed(1)} КБ`;
}

function Row({
  row, active, hot, onPick, onHover,
}: {
  row: PlanRow;
  active: boolean;
  hot: boolean;
  onPick: () => void;
  onHover: (id: string | null) => void;
}) {
  const { node } = row;
  const tint = `var(${NODE_VAR[node.status]})`;
  const live = node.status === 'running' || node.status === 'review';

  return (
    <button
      onClick={onPick}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      className="w-full text-left rounded-xl px-2.5 py-2 active:scale-[0.99] transition-colors"
      style={{
        background: hot
          ? 'color-mix(in srgb, var(--accent) 16%, transparent)'
          : active
            ? 'var(--glass-card)'
            : 'transparent',
        border: `1px solid ${hot ? 'var(--accent)' : active ? 'var(--glass-border-hover)' : 'transparent'}`,
        boxShadow: hot ? '0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none',
        minHeight: 44,
      }}
      data-hot={hot || undefined}
      data-testid={`plan-row-${node.id}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${live ? 'animate-pulse' : ''}`}
          style={{ background: tint, boxShadow: live ? `0 0 7px ${tint}` : 'none' }}
        />
        <span
          className="flex-1 min-w-0 truncate"
          style={{
            fontSize: 'var(--fs-xs)',
            color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
          }}
        >
          {node.title}
        </span>
        {row.critical && (
          <span
            className="shrink-0 font-mono"
            style={{ fontSize: 9, color: 'var(--primary)' }}
            title="критичний шлях"
          >
            ▲
          </span>
        )}
        {row.artifacts.length > 0 && (
          <span className="shrink-0 font-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
            {row.artifacts.length} ф.
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1 ml-3.5">
        <span className="font-mono shrink-0" style={{ fontSize: 9, color: tint }}>
          {NODE_LABEL[node.status]}
        </span>
        {row.crew && (
          <span
            className="truncate min-w-0"
            style={{ fontSize: 9, color: 'var(--ink-faint)' }}
          >
            {row.crew.replace(/_/g, ' ')}
          </span>
        )}
        <div className="flex-1" />
        {row.minutes !== null && row.minutes > 0 && (
          <span className="font-mono shrink-0" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
            {humanMinutes(row.minutes)}
          </span>
        )}
      </div>
      {row.progress > 0 && row.progress < 1 && (
        <div
          className="h-[2px] rounded-full mt-1 ml-3.5 overflow-hidden"
          style={{ background: 'var(--glass-subtle)' }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${row.progress * 100}%`, background: tint }}
          />
        </div>
      )}
    </button>
  );
}

/** Живий хвіст того, що вузол пише просто зараз. */
function LiveTail({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div
      ref={ref}
      className="rounded-lg px-2 py-1.5 overflow-y-auto font-mono"
      style={{
        maxHeight: 78,
        background: 'var(--glass-subtle)',
        fontSize: 10,
        lineHeight: 1.5,
        color: 'var(--ink-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </div>
  );
}

function Detail({ row }: { row: PlanRow }) {
  const missionId = usePolisStore((s) => s.selectedMissionId);
  const transcript = usePolisStore((s) =>
    missionId ? (s.transcripts[`${missionId}:${row.node.id}`] ?? '') : '',
  );
  const openArtifact = usePolisStore((s) => s.openArtifact);
  const { node } = row;
  const tint = `var(${NODE_VAR[node.status]})`;
  const pressure = node.budget.max_tokens
    ? Math.round((node.budget.spent_tokens / node.budget.max_tokens) * 100)
    : 0;

  return (
    <div className="h-full overflow-y-auto px-2.5 py-2 flex flex-col gap-2" data-testid="node-detail">
      <div>
        <div
          className="truncate"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
          title={node.title}
        >
          {node.title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="font-mono" style={{ fontSize: 9, color: tint }}>
            {NODE_LABEL[node.status]}
          </span>
          {row.citizen && (
            <span style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
              {row.citizen.name}
            </span>
          )}
        </div>
      </div>

      {/* Чому стоїть — питання, на яке досі не відповідав жоден екран */}
      {row.waitingFor.length > 0 && (
        <div
          className="rounded-lg px-2 py-1.5"
          style={{ background: 'color-mix(in srgb, var(--ink-muted) 10%, transparent)' }}
        >
          <div className="font-mono mb-0.5" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
            ЧЕКАЄ НА
          </div>
          {row.waitingFor.map((t) => (
            <div key={t} className="truncate" style={{ fontSize: 10, color: 'var(--ink-secondary)' }}>
              {t}
            </div>
          ))}
        </div>
      )}

      {node.error && (
        <div
          className="rounded-lg px-2 py-1.5"
          style={{ background: 'color-mix(in srgb, var(--signal-alert) 12%, transparent)' }}
        >
          <div className="font-mono mb-0.5" style={{ fontSize: 9, color: 'var(--signal-alert)' }}>
            ЗРИВ · спроба {node.attempts}/{node.max_attempts}
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink-secondary)' }}>{node.error}</div>
        </div>
      )}

      {node.output_summary && !node.error && (
        <div style={{ fontSize: 10, color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
          {node.output_summary}
        </div>
      )}

      {transcript && (
        <div>
          <div className="font-mono mb-1" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
            ЗАРАЗ
          </div>
          <LiveTail text={transcript.slice(-1200)} />
        </div>
      )}

      {row.artifacts.length > 0 && (
        <div>
          <div className="font-mono mb-1" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
            ВИДАВ · {row.artifacts.length}
          </div>
          <div className="flex flex-col gap-0.5">
            {row.artifacts.map((a) => (
              <button
                key={a.name}
                onClick={() => missionId && void openArtifact(missionId, a.name)}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left active:scale-[0.98]"
                style={{ background: 'var(--glass-subtle)', minHeight: 26 }}
                data-testid={`node-file-${a.name}`}
              >
                <span
                  className="flex-1 min-w-0 truncate font-mono"
                  style={{ fontSize: 10, color: 'var(--primary)' }}
                >
                  {a.name.split('/').pop()}
                </span>
                <span className="shrink-0 font-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
                  {kb(a.size)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ціна вузла: досі бюджет був видно лише на місії цілком */}
      <div className="mt-auto pt-1" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <div className="flex items-center justify-between font-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
          <span>{node.budget.spent_llm_calls} викл. · {pressure}% бюджету</span>
          {row.minutes !== null && <span>{humanMinutes(row.minutes)}</span>}
        </div>
      </div>
    </div>
  );
}

export function PlanRail({
  hoverNode, onHoverNode, onDocs,
}: {
  hoverNode: string | null;
  onHoverNode: (id: string | null) => void;
  onDocs: () => void;
}) {
  const mission = usePolisStore((s) => s.missions.find((m) => m.id === s.selectedMissionId));
  const artifacts = usePolisStore((s) =>
    s.selectedMissionId ? (s.artifacts[s.selectedMissionId] ?? []) : [],
  );
  const citizens = usePolisStore((s) => s.citizens);
  const focus = usePolisStore((s) => s.inspectorNodeId);
  const openInspector = usePolisStore((s) => s.openInspector);

  const rows = buildPlan(mission, artifacts, citizens, Date.now());
  const failed = rows.filter((r) => r.node.status === 'failed').length;
  const selected = rows.find((r) => r.node.id === focus)
    // без явного вибору показуємо той вузол, де зараз життя
    ?? rows.find((r) => r.node.status === 'running')
    ?? rows.find((r) => r.node.status === 'failed')
    ?? rows[0];

  return (
    <div className="h-full flex flex-col min-h-0 glass-card rounded-3xl overflow-hidden" data-testid="plan-rail">
      <header
        className="shrink-0 flex items-center gap-2 px-3 h-[34px]"
        style={{ borderBottom: '1px solid var(--glass-border)' }}
      >
        <span
          className="font-mono"
          style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-faint)', letterSpacing: 'var(--tracking-wide)' }}
        >
          ПЛАН
        </span>
        <span className="font-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
          {rows.filter((r) => r.node.status === 'done').length}/{rows.length}
        </span>
        {failed > 0 && (
          <span className="font-mono" style={{ fontSize: 9, color: 'var(--signal-alert)' }}>
            {failed} зрив
          </span>
        )}
        <div className="flex-1" />
        {/* усі матеріали місії — поруч із тими, хто їх зробив */}
        <button
          onClick={onDocs}
          className="h-[26px] px-2 rounded-lg flex items-center gap-1 active:scale-[0.97]"
          style={{ background: 'var(--glass-subtle)', color: 'var(--ink-secondary)', fontSize: 10 }}
          data-testid="open-materials"
          title="усі матеріали місії"
        >
          <FolderOpen size={11} />
          {artifacts.length}
        </button>
      </header>

      <div className="overflow-y-auto px-1.5 py-1.5 flex flex-col gap-0.5" style={{ maxHeight: '52%' }}>
        {rows.length === 0 && (
          <p className="px-1.5 py-2" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
            План з'явиться, щойно місія розкладеться на кроки.
          </p>
        )}
        {rows.map((r) => (
          <Row
            key={r.node.id}
            row={r}
            active={selected?.node.id === r.node.id}
            hot={hoverNode === r.node.id}
            onPick={() => openInspector(r.node.id)}
            onHover={onHoverNode}
          />
        ))}
      </div>

      <div
        className="flex-1 min-h-0"
        style={{ borderTop: '1px solid var(--glass-border)' }}
      >
        {selected ? (
          <Detail row={selected} />
        ) : (
          <p className="px-3 py-3" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
            Обери крок, щоб побачити, що він робить і що видав.
          </p>
        )}
      </div>
    </div>
  );
}
