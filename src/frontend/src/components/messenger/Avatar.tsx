import React, { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  className?: string;
  radius?: string;
}

// Аватара може не бути — і це нормальний стан, а не помилка.
// Насичений кольоровий блок із білими літерами читався як дитяча наліпка:
// колір несе тільки літера, підкладка лишається паперовою.
const inkTones = ['#D96C35', '#6E7568', '#8A5A33', '#4C8A55'];

export const Avatar: React.FC<AvatarProps> = ({ src, name, className = 'w-9 h-9', radius = 'rounded-[12px]' }) => {
  const [broken, setBroken] = useState(false);
  const usable = src && src.trim() && !broken;

  if (usable) {
    return (
      <img
        src={src as string}
        alt={name}
        onError={() => setBroken(true)}
        className={`${className} ${radius} object-cover ring-1 ring-[#E8E1D3]`}
      />
    );
  }

  const letters = (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  const tone = inkTones[[...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % inkTones.length];

  return (
    <div
      className={`${className} ${radius} text-xs flex items-center justify-center font-semibold select-none bg-[#EFE9DC] border border-[#E8E1D3]`}
      style={{ color: tone, letterSpacing: '0.01em' }}
      aria-label={name}
    >
      {letters.toUpperCase()}
    </div>
  );
};

export default Avatar;
