import React, { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  className?: string;
}

// Аватара може не бути — і це нормальний стан, а не помилка. Битою картинкою
// з підписом «Мар» це виглядало так, ніби застосунок зламався; ініціали на
// теплому колі кажуть те саме чесніше.
// Середня насиченість: темні тони (#5F6A60, #8A5333) на 36px читались як чорні блоки.
const palette = ['#E87A42', '#D97706', '#58975F', '#C25925', '#4C9A83', '#B07B4F'];

export const Avatar: React.FC<AvatarProps> = ({ src, name, className = 'w-9 h-9' }) => {
  const [broken, setBroken] = useState(false);
  const usable = src && src.trim() && !broken;

  if (usable) {
    return (
      <img
        src={src as string}
        alt={name}
        onError={() => setBroken(true)}
        className={`${className} rounded-xl object-cover ring-1 ring-[#E6DFD3] shadow-sm`}
      />
    );
  }

  const letters = (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  const tone = palette[[...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

  return (
    <div
      className={`${className} rounded-xl flex items-center justify-center font-bold text-white shadow-sm select-none`}
      style={{ background: tone, fontSize: '0.75rem' }}
      aria-label={name}
    >
      {letters.toUpperCase()}
    </div>
  );
};

export default Avatar;
