import { useMemo, useState, useCallback } from 'react';
import { Copy, Check, Terminal as TerminalIcon } from 'lucide-react';

export interface CodeBlockData {
  language: string;
  code: string;
  filename?: string;
}

interface CodeBlockProps {
  data: CodeBlockData;
}

const LANGUAGE_LABELS: Record<string, string> = {
  python: 'PY',
  py: 'PY',
  javascript: 'JS',
  js: 'JS',
  typescript: 'TS',
  ts: 'TS',
  tsx: 'TSX',
  jsx: 'JSX',
  bash: 'SH',
  shell: 'SH',
  sh: 'SH',
  zsh: 'SH',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  c: 'C',
  cpp: 'C++',
  rust: 'RS',
  go: 'GO',
  java: 'JAVA',
  text: 'TXT',
};

/** Minimalist token-based highlighter (no deps). Good enough for chat display. */
function highlight(code: string, language: string): Array<{ text: string; cls: string }> {
  const lang = language.toLowerCase();
  const tokens: Array<{ text: string; cls: string }> = [];

  const keywords: Record<string, RegExp> = {
    python: /\b(def|class|import|from|as|if|elif|else|for|while|return|yield|with|try|except|finally|raise|pass|break|continue|lambda|and|or|not|is|in|None|True|False|async|await|global|nonlocal)\b/g,
    py: /\b(def|class|import|from|as|if|elif|else|for|while|return|yield|with|try|except|finally|raise|pass|break|continue|lambda|and|or|not|is|in|None|True|False|async|await|global|nonlocal)\b/g,
    javascript: /\b(const|let|var|function|class|extends|return|if|else|for|while|do|switch|case|break|continue|new|this|super|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false)\b/g,
    js: /\b(const|let|var|function|class|extends|return|if|else|for|while|do|switch|case|break|continue|new|this|super|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false)\b/g,
    typescript: /\b(const|let|var|function|class|extends|implements|interface|type|enum|return|if|else|for|while|do|switch|case|break|continue|new|this|super|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|public|private|protected|readonly|abstract|static|void|never|unknown|any)\b/g,
    ts: /\b(const|let|var|function|class|extends|implements|interface|type|enum|return|if|else|for|while|do|switch|case|break|continue|new|this|super|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|public|private|protected|readonly|abstract|static|void|never|unknown|any)\b/g,
    tsx: /\b(const|let|var|function|class|extends|implements|interface|type|enum|return|if|else|for|while|do|switch|case|break|continue|new|this|super|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|public|private|protected|readonly|abstract|static|void|never|unknown|any)\b/g,
    bash: /\b(if|then|else|fi|for|do|done|while|case|esac|function|return|export|source|echo|cd|ls|cat|grep|sed|awk|mkdir|rm|mv|cp|sudo)\b/g,
    sh: /\b(if|then|else|fi|for|do|done|while|case|esac|function|return|export|source|echo|cd|ls|cat|grep|sed|awk|mkdir|rm|mv|cp|sudo)\b/g,
    sql: /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|DROP|ALTER|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN)\b/gi,
  };

  const keywordRegex = keywords[lang] ?? keywords['js'];

  let remaining = code;
  const segments: Array<{ text: string; cls: string; idx: number; len: number }> = [];

  const patterns: Array<{ regex: RegExp; cls: string }> = [
    { regex: /(^|\s)(#.*$|\/\/.*$)/gm, cls: 'comment' },
    { regex: /\/\*[\s\S]*?\*\//g, cls: 'comment' },
    { regex: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, cls: 'string' },
    { regex: /\b-?\d+(?:\.\d+)?\b/g, cls: 'number' },
    { regex: keywordRegex, cls: 'keyword' },
  ];

  patterns.forEach(({ regex, cls }) => {
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(remaining)) !== null) {
      segments.push({ text: m[0], cls, idx: m.index, len: m[0].length });
    }
  });

  // Sort by index and remove overlaps
  segments.sort((a, b) => a.idx - b.idx);
  const filtered: typeof segments = [];
  let lastEnd = -1;
  for (const s of segments) {
    if (s.idx >= lastEnd) {
      filtered.push(s);
      lastEnd = s.idx + s.len;
    }
  }

  let cursor = 0;
  for (const seg of filtered) {
    if (seg.idx > cursor) {
      tokens.push({ text: remaining.slice(cursor, seg.idx), cls: 'plain' });
    }
    tokens.push({ text: seg.text, cls: seg.cls });
    cursor = seg.idx + seg.len;
  }
  if (cursor < remaining.length) {
    tokens.push({ text: remaining.slice(cursor), cls: 'plain' });
  }

  return tokens;
}

const TOKEN_COLOR: Record<string, string> = {
  keyword: 'var(--accent)',
  string: 'var(--signal-ok)',
  number: 'var(--signal-warn)',
  comment: 'var(--ink-muted)',
  plain: 'var(--ink-primary)',
};

export function CodeBlock({ data }: CodeBlockProps) {
  const { language, code, filename } = data;
  const [copied, setCopied] = useState(false);

  const tokens = useMemo(() => highlight(code, language), [code, language]);
  const lines = useMemo(() => code.split('\n'), [code]);
  const langLabel = LANGUAGE_LABELS[language.toLowerCase()] ?? language.toUpperCase();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — ignore
    }
  }, [code]);

  return (
    <div
      className="rounded-md overflow-hidden flex flex-col"
      style={{
        background: 'var(--surface-void)',
        border: '1px solid var(--line-default)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 shrink-0"
        style={{
          background: 'var(--surface-raised)',
          borderBottom: '1px solid var(--line-subtle)',
        }}
      >
        <TerminalIcon size={12} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
        <span
          className="font-mono tracking-wider"
          style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }}
        >
          {langLabel}
        </span>
        {filename && (
          <>
            <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>·</span>
            <span
              className="font-mono truncate"
              style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-micro)' }}
            >
              {filename}
            </span>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 rounded transition-colors"
          style={{
            minWidth: 44,
            minHeight: 44,
            color: copied ? 'var(--signal-ok)' : 'var(--ink-muted)',
            fontSize: 'var(--fs-micro)',
          }}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.5} />}
          <span className="font-mono tracking-wider">{copied ? 'COPIED' : 'COPY'}</span>
        </button>
      </div>

      {/* Content */}
      <div
        className="overflow-x-auto overflow-y-auto"
        style={{ maxHeight: 260 }}
      >
        <table className="w-full" style={{ fontFamily: 'var(--font-tech)', fontSize: 'var(--fs-xs)' }}>
          <tbody>
            {lines.map((_, lineIdx) => (
              <tr key={lineIdx}>
                <td
                  className="select-none text-right pr-3 pl-3 align-top"
                  style={{
                    color: 'var(--ink-muted)',
                    width: 32,
                    lineHeight: 'var(--lh-normal)',
                  }}
                >
                  {lineIdx + 1}
                </td>
                <td
                  className="pr-3 whitespace-pre align-top"
                  style={{ lineHeight: 'var(--lh-normal)' }}
                >
                  {lineIdx === 0 ? (
                    <LineContent tokens={tokens} lineIdx={lineIdx} lines={lines} />
                  ) : (
                    <LineContent tokens={tokens} lineIdx={lineIdx} lines={lines} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LineContent({
  tokens,
  lineIdx,
  lines,
}: {
  tokens: Array<{ text: string; cls: string }>;
  lineIdx: number;
  lines: string[];
}) {
  // Compute offset for this line in the original code
  let offset = 0;
  for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1; // +1 for newline
  const lineLen = lines[lineIdx].length;
  const lineEnd = offset + lineLen;

  const out: Array<{ text: string; cls: string; key: number }> = [];
  let cursor = 0;
  let keyCounter = 0;
  for (const tok of tokens) {
    const tokStart = cursor;
    const tokEnd = cursor + tok.text.length;

    if (tokEnd <= offset) {
      cursor = tokEnd;
      continue;
    }
    if (tokStart >= lineEnd) break;

    const localStart = Math.max(tokStart, offset) - offset;
    const localEnd = Math.min(tokEnd, lineEnd) - offset;
    const absStart = Math.max(tokStart, offset);
    const absEnd = Math.min(tokEnd, lineEnd);
    const sliceText = tok.text.slice(absStart - tokStart, absEnd - tokStart);
    if (sliceText.length > 0) {
      out.push({ text: sliceText, cls: tok.cls, key: keyCounter++ });
    }
    cursor = tokEnd;
    if (localEnd >= lineLen) break;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void localStart;
  }

  return (
    <>
      {out.map((s) => (
        <span key={s.key} style={{ color: TOKEN_COLOR[s.cls] ?? 'var(--ink-primary)' }}>
          {s.text}
        </span>
      ))}
    </>
  );
}
