import { useMemo } from 'react';

interface MarkdownResponseProps {
  content: string;
}

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'pre'; code: string; lang?: string }
  | { kind: 'p'; text: string }
  | { kind: 'hr' };

function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    // Fenced code block
    if (/^```/.test(trimmed)) {
      const lang = trimmed.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: 'pre', code: codeLines.join('\n'), lang });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Headings
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      blocks.push({ kind: (`h${level}` as 'h1' | 'h2' | 'h3'), text: h[2].trim() });
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'blockquote', text: quoteLines.join(' ') });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Paragraph (collect contiguous non-empty, non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^(-{3,}|_{3,}|\*{3,})$/.test(lines[i].trim()) &&
      !/^```/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'p', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

/** Render inline formatting: **bold**, *italic*, `code`, [text](url) */
function renderInline(text: string, keyBase = 0): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  let k = keyBase;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      out.push(
        <strong key={k++} style={{ color: 'var(--ink-primary)', fontWeight: 600 }}>
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*')) {
      out.push(
        <em key={k++} style={{ color: 'var(--ink-primary)' }}>
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`')) {
      out.push(
        <code
          key={k++}
          className="font-mono rounded px-1"
          style={{
            background: 'var(--surface-void)',
            color: 'var(--accent)',
            fontSize: '0.9em',
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (linkMatch) {
        out.push(
          <a
            key={k++}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'underline' }}
          >
            {linkMatch[1]}
          </a>
        );
      }
    }
    cursor = m.index + token.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function MarkdownResponse({ content }: MarkdownResponseProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  const common = {
    color: 'var(--ink-primary)',
    fontSize: 'var(--fs-sm)',
    lineHeight: 'var(--lh-normal)',
  };

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'h1':
            return (
              <h1
                key={idx}
                className="font-mono tracking-wider"
                style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-lg)' }}
              >
                {renderInline(block.text)}
              </h1>
            );
          case 'h2':
            return (
              <h2
                key={idx}
                className="font-mono tracking-wider"
                style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-md)' }}
              >
                {renderInline(block.text)}
              </h2>
            );
          case 'h3':
            return (
              <h3
                key={idx}
                className="font-mono tracking-wider"
                style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)' }}
              >
                {renderInline(block.text)}
              </h3>
            );
          case 'hr':
            return (
              <div
                key={idx}
                style={{ height: 1, background: 'var(--line-subtle)', margin: '4px 0' }}
              />
            );
          case 'blockquote':
            return (
              <blockquote
                key={idx}
                className="pl-3"
                style={{
                  borderLeft: '2px solid var(--accent)',
                  color: 'var(--ink-secondary)',
                  fontSize: 'var(--fs-sm)',
                  fontStyle: 'italic',
                }}
              >
                {renderInline(block.text)}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={idx} className="list-disc pl-5" style={common}>
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item, i * 10)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="list-decimal pl-5" style={common}>
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item, i * 10)}</li>
                ))}
              </ol>
            );
          case 'pre':
            return (
              <pre
                key={idx}
                className="font-mono rounded-md p-2 whitespace-pre-wrap overflow-x-auto"
                style={{
                  background: 'var(--surface-void)',
                  border: '1px solid var(--line-subtle)',
                  color: 'var(--ink-primary)',
                  fontSize: 'var(--fs-xs)',
                  lineHeight: 'var(--lh-normal)',
                }}
              >
                {block.code}
              </pre>
            );
          case 'p':
          default:
            return (
              <p key={idx} style={common}>
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
