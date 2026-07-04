/** Документи — every artifact the mission produces, readable in place,
 * refreshed live as nodes finish. */
import { usePolisStore } from '../../../stores/polisStore';
import { MarkdownResponse } from '../../chat/MarkdownResponse';

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} кБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function DocumentsPanel() {
  const missionId = usePolisStore((s) => s.selectedMissionId);
  const artifacts = usePolisStore((s) =>
    missionId ? (s.artifacts[missionId] ?? []) : [],
  );
  const openDoc = usePolisStore((s) => s.openDoc);
  const openArtifact = usePolisStore((s) => s.openArtifact);
  const closeArtifact = usePolisStore((s) => s.closeArtifact);

  if (openDoc) {
    return (
      <div className="h-full flex flex-col" data-testid="doc-reader">
        <header
          className="flex items-center gap-3 px-4 py-2"
          style={{ borderBottom: '1px solid var(--glass-border)' }}
        >
          <button
            onClick={closeArtifact}
            className="min-w-[44px] min-h-[44px] rounded-xl active:scale-[0.95]"
            style={{ background: 'var(--glass-subtle)', color: 'var(--ink-secondary)' }}
            aria-label="назад до списку"
          >
            ←
          </button>
          <span
            className="font-mono truncate"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}
          >
            {openDoc.name}
          </span>
        </header>
        <div
          className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
        >
          <MarkdownResponse content={openDoc.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-3" data-testid="doc-list">
      {artifacts.length === 0 && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
          Документів ще нема — вони з'являться, щойно перший воркер завершить
          крок.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {artifacts.map((a) => (
          <button
            key={a.name}
            onClick={() => missionId && void openArtifact(missionId, a.name)}
            className="rounded-xl p-3 text-left min-h-[72px] active:scale-[0.98]"
            style={{
              background: 'var(--glass-card)',
              border: '1px solid var(--glass-border)',
            }}
            data-testid={`doc-${a.name}`}
          >
            <p
              className="truncate"
              style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
            >
              📄 {a.title}
            </p>
            <p
              className="font-mono mt-1"
              style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
            >
              {sizeLabel(a.size)} ·{' '}
              {new Date(a.updated_at).toLocaleTimeString('uk-UA', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
