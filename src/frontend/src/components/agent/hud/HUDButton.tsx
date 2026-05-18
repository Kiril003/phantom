import React from 'react';

interface HUDButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  color: string;
  small?: boolean;
}

export function HUDButton({ icon, onClick, color, small = false }: HUDButtonProps) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center justify-center transition-all hover:bg-black/5 active:scale-90"
      style={{
        width: small ? 36 : 44,
        height: small ? 36 : 44,
        borderRadius: small ? 14 : 18,
        color: color,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
        background: `color-mix(in srgb, ${color} 5%, transparent)`,
      }}
    >
      {icon}
    </button>
  );
}
