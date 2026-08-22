import React, { useState } from 'react';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface FormattedMessageTextProps {
  text: string;
  isSelf?: boolean;
  onMentionClick?: (handleOrName: string) => void;
  searchQuery?: string;
  isActiveMatch?: boolean;
}

export const FormattedMessageText: React.FC<FormattedMessageTextProps> = ({
  text,
  isSelf,
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

    const highlightStyle = isActiveMatch
      ? 'bg-[#E87A42] text-[#1E2521] font-bold px-1 py-0.5 rounded-xs shadow-xs inline-block'
      : isSelf
      ? 'bg-[#F5A623] text-black font-bold px-0.5 py-0.2 rounded-xs shadow-2xs inline-block'
      : 'bg-[#FFE082] text-[#1E2521] font-semibold px-0.5 py-0.2 rounded-xs shadow-2xs inline-block';

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
        <p key={lineIdx} className={`break-words [overflow-wrap:anywhere] ${lineIdx > 0 ? 'mt-1.5' : ''}`}>
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
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md cursor-pointer transition-all select-none mx-0.5 font-medium text-xs ${
                    isRevealed
                      ? isSelf
                        ? 'bg-white/20 text-[#1E2521]'
                        : 'bg-[#EFE7D8] text-[#1E2521]'
                      : isSelf
                      ? 'bg-white/30 text-transparent blur-[4px] hover:blur-[2px]'
                      : 'bg-[#DCD0BE] text-transparent blur-[4px] hover:blur-[2px]'
                  }`}
                  title={isRevealed ? 'Спойлер (клікніть щоб приховати)' : 'Спойлер (клікніть щоб відкрити)'}
                >
                  <span>{isRevealed ? highlightContent(spoilerContent) : spoilerContent}</span>
                  <span className="text-[9px] opacity-70 ml-0.5">
                    {isRevealed ? <EyeOff className="w-2.5 h-2.5 inline" /> : <Eye className="w-2.5 h-2.5 inline text-black/50" />}
                  </span>
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
                  className={`inline-flex items-center gap-1 font-semibold underline underline-offset-2 break-all hover:opacity-80 transition-opacity ${
                    isSelf ? 'text-[#F5A623] hover:text-[#FFC107]' : 'text-[#E87A42] hover:text-[#D46B35]'
                  }`}
                >
                  <span>{highlightContent(token)}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 inline opacity-70" />
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
                  className={`inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded-md font-bold text-xs transition-all ${
                    isSelf
                      ? 'bg-[#E87A42]/30 text-[#FFD4A3] hover:bg-[#E87A42]/50'
                      : 'bg-[#FCE7D8] text-[#A84813] hover:bg-[#F9CCA8]'
                  }`}
                  title={`Переглянути профіль @${handle}`}
                >
                  @{highlightContent(handle)}
                </button>
              );
            }

            // 4. Hashtags: #tag
            if (token.startsWith('#') && token.length > 1) {
              return (
                <span
                  key={uniqueKey}
                  className={`font-semibold opacity-90 mx-0.5 ${
                    isSelf ? 'text-[#85E3A1]' : 'text-[#3E7B44]'
                  }`}
                >
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
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] mx-0.5 select-text ${
                    isSelf
                      ? 'bg-black/40 text-[#A8D5BA] border border-white/10'
                      : 'bg-[#EFE9DD] text-[#7A8479] border border-[#DFD6C5]'
                  }`}
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

  return <div className="leading-relaxed select-text break-words [overflow-wrap:anywhere]">{renderFormattedSegments()}</div>;
};
