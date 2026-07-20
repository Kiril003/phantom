import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

function isChunkLoadError(error: Error): boolean {
  // A stale deploy or offline webview fails to fetch a lazy chunk. Vite/
  // Rollup surface this as ChunkLoadError or a "dynamically imported
  // module" fetch failure — a reload (fresh manifest) is the real fix.
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(
      error.message,
    )
  );
}

/**
 * App-level error boundary around the lazy route/overlay tree. Without it a
 * failed chunk load (offline, stale deploy) or a render throw blanks the whole
 * screen. Token-styled, no hardcoded colours; offers retry (and a reload for
 * chunk-load failures). Copy is Ukrainian-first per the product's locale.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunk = isChunkLoadError(error);
    return (
      <div
        role="alert"
        className="w-full h-full flex items-center justify-center p-8"
        style={{ background: 'var(--surface-void)' }}
      >
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <span
            className="font-serif italic"
            style={{ color: 'var(--ink-base)', fontSize: 'var(--fs-lg)' }}
          >
            {chunk ? 'Оновлення застаріло.' : 'Щось зламалось.'}
          </span>
          <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-sm)' }}>
            {chunk
              ? 'Перезавантаж, щоб отримати свіжу версію.'
              : 'Спробуй ще раз — стан збережено.'}
          </span>
          <button
            type="button"
            onClick={chunk ? () => window.location.reload() : this.reset}
            className="px-4 py-2 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2"
            style={{
              background: 'var(--glass-card)',
              color: 'var(--ink-base)',
              border: '1px solid var(--line-subtle)',
              minHeight: 44,
            }}
          >
            {chunk ? 'Перезавантажити' : 'Спробувати ще раз'}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
