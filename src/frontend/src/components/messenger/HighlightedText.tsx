import React from 'react';

interface HighlightedTextProps {
  text?: string;
  query?: string;
  className?: string;
  highlightClassName?: string;
  activeMatch?: boolean;
}

export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  query,
  className = '',
  highlightClassName,
  activeMatch = false,
}) => {
  if (!text) return null;
  if (!query || !query.trim()) {
    return <span className={className}>{text}</span>;
  }

  const cleanQuery = query.trim();
  const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) {
    return <span className={className}>{text}</span>;
  }

  const defaultHighlightClass = activeMatch
    ? 'bg-[#E87A42] text-white font-bold px-1 py-0.5 rounded-xs shadow-xs'
    : 'bg-[#FFD54F] text-[#1F2521] font-semibold px-1 py-0.5 rounded-xs shadow-2xs';

  return (
    <span className={className}>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className={highlightClassName || defaultHighlightClass}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};
