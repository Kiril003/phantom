import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface FormattedMessageTextProps {
  text: string;
  onMentionClick?: (handleOrName: string) => void;
  searchQuery?: string;
  isActiveMatch?: boolean;
}

export const FormattedMessageText: React.FC<FormattedMessageTextProps> = ({
  text,
  onMentionClick,
  searchQuery,
  isActiveMatch,
}) => {
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<number, boolean>>({});

  const toggleSpoiler = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    soundFx.playTap();
    setRevealedSpoilers((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const highlightContent = (content: string) => {
    if (!searchQuery || !searchQuery.trim()) return content;
    const escaped = searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = content.split(regex);
    if (parts.length === 1) return content;

    // Підсвітка пошуку: активний збіг — тепла заливка, решта — тиха.
    const highlightStyle = isActiveMatch
      ? 'bg-[#F1D9C4] text-[#21261F] rounded-sm px-0.5'
      : 'bg-[#F3EEE3] text-[#21261F] rounded-sm px-0.5';

    return parts.map((part, idx) =>
      regex.test(part) ? (
        <mark key={idx} className={highlightStyle}>
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Safe multi-pass regex parser
  const renderFormattedSegments = () => {
    // Regex for mentions, links, spoilers, bold, italic, strikethrough, inline code
    const parts = text.split('\n');

    return parts.map((line, lineIdx) => {
      // Parse individual line tokens
      // Pattern captures:
      // 1. Spoilers: ||spoiler||
      // 2. URLs: https?://...
      // 3. Mentions: @[a-zA-Z0-9_\u0400-\u04FF]+
      // 4. Bold: \*\*(.+?)\*\*
      // 5. Italic: \*([^*]+)\*
      // 6. Strikethrough: ~(.+?)~
      // 7. Inline code: `([^`]+)`
      // 8. Hashtags: #[a-zA-Z0-9_\u0400-\u04FF]+

      const masterRegex = /(\|\|.+?\|\||https?:\/\/[^\s]+|@[a-zA-Z0-9_\u0400-\u04FF]+|\*\*.+?\*\*|\*[^*]+\*|~.+?~|`[^`]+`|#[a-zA-Z0-9_\u0400-\u04FF]+)/g;
      const tokens = line.split(masterRegex);

      return (
        <p key={lineIdx} className={`break-words ${lineIdx > 0 ? 'mt-1.5' : ''}`}>
          {tokens.map((token, tokenIdx) => {
            const uniqueKey = `${lineIdx}-${tokenIdx}`;

            // 1. Spoiler: ||text||
            if (token.startsWith('||') && token.endsWith('||') && token.length >= 4) {
              const spoilerContent = token.slice(2, -2);
              const isRevealed = !!revealedSpoilers[tokenIdx + lineIdx * 100];

              return (
                <span
                  key={uniqueKey}
                  onClick={(e) => toggleSpoiler(tokenIdx + lineIdx * 100, e)}
                  className={`inline-flex items-center gap-1 px-1 rounded cursor-pointer transition-all select-none ${
                    isRevealed
                      ? 'bg-[#F3EEE3] text-[#21261F]'
                      : 'bg-[#E2DACB] text-transparent blur-[4px] hover:blur-[2px]'
                  }`}
                  title={isRevealed ? 'Спойлер (клікніть щоб приховати)' : 'Спойлер (клікніть щоб відкрити)'}
                >
                  <span>{isRevealed ? highlightContent(spoilerContent) : spoilerContent}</span>
                  {isRevealed ? (
                    <EyeOff className="w-3.5 h-3.5 inline text-[#6E7568]" strokeWidth={1.75} />
                  ) : (
                    <Eye className="w-3.5 h-3.5 inline text-[#6E7568]" strokeWidth={1.75} />
                  )}
                </span>
              );
            }

            // 2. URLs
            if (token.startsWith('http://') || token.startsWith('https://')) {
              return (
                <a
                  key={uniqueKey}
                  href={token}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline underline underline-offset-2 decoration-[#D96C35]/40 break-all text-[#B85425] hover:decoration-[#D96C35] transition-colors"
                >
                  {highlightContent(token)}
                </a>
              );
            }

            // 3. User Mentions: @name
            if (token.startsWith('@') && token.length > 1) {
              const handle = token.slice(1);
              return (
                <button
                  type="button"
                  key={uniqueKey}
                  onClick={(e) => {
                    e.stopPropagation();
                    soundFx.playTap();
                    onMentionClick?.(handle);
                  }}
                  className="inline font-medium text-[#B85425] hover:underline underline-offset-2 transition-colors align-baseline"
                  title={`Переглянути профіль @${handle}`}
                >
                  @{highlightContent(handle)}
                </button>
              );
            }

            // 4. Hashtags: #tag
            if (token.startsWith('#') && token.length > 1) {
              return (
                <span key={uniqueKey} className="font-medium text-[#4C8A55]">
                  #{highlightContent(token.slice(1))}
                </span>
              );
            }

            // 5. Bold: **text**
            if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
              return (
                <strong key={uniqueKey} className="font-bold">
                  {highlightContent(token.slice(2, -2))}
                </strong>
              );
            }

            // 6. Italic: *text*
            if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
              return (
                <em key={uniqueKey} className="italic opacity-95">
                  {highlightContent(token.slice(1, -1))}
                </em>
              );
            }

            // 7. Strikethrough: ~text~
            if (token.startsWith('~') && token.endsWith('~') && token.length >= 2) {
              return (
                <del key={uniqueKey} className="line-through opacity-60">
                  {highlightContent(token.slice(1, -1))}
                </del>
              );
            }

            // 8. Inline Code: `code`
            if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
              return (
                <code
                  key={uniqueKey}
                  className="px-1 py-0.5 rounded font-mono text-[13px] select-text bg-[#F3EEE3] text-[#21261F] border border-[#E8E1D3]"
                >
                  {highlightContent(token.slice(1, -1))}
                </code>
              );
            }

            // Plain text
            return <React.Fragment key={uniqueKey}>{highlightContent(token)}</React.Fragment>;
          })}
        </p>
      );
    });
  };

  return <div className="select-text break-words">{renderFormattedSegments()}</div>;
};
