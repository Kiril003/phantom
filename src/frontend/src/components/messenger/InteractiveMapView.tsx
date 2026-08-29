import React, { useState } from 'react';
import {
  Car,
  Layers,
  BookOpen,
  Compass,
  ShoppingBag,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { LocationData, UserProfile } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { useUIStore } from '../../stores/uiStore';

interface InteractiveMapViewProps {
  onSelectLocation: (loc: LocationData) => void;
  currentUser: UserProfile;
}

const mapSpots: (LocationData & { icon: string; pinType: string; x: number; y: number })[] = [
  {
    id: 'spot_b_fresh',
    name: 'B Fresh',
    category: 'магазин · продукти · 129 км · ≈ 2071 хв пішки',
    address: 'Вулиця Всеволода Змієнка (Київ)',
    distance: '129 км',
    walkingTime: '≈ 2071 хв пішки',
    coords: { lat: 50.4501, lng: 30.5234 },
    hours: '08:30 – 22:00',
    icon: 'bag',
    pinType: 'primary',
    x: 48,
    y: 38,
    dossier: {
      title: 'B Fresh',
      category: 'магазин · продукти',
      address: 'Вулиця Всеволода Змієнка (Київ)',
      vibe: 'Сучасний концепт-маркет з фермерськими товарами, спешелті кавою та теплою терасою.',
      bestHours: '08:30 – 22:00 (Спокійний період: 12:00 – 16:00)',
      crowdLevel: 'Помірний',
      atmosphere: ['🌿 Органічні продукти', '🥐 Свіжі круасани', '☕ Specialty Coffee', '🐕 Pet-friendly'],
      transitTips: 'Вулиця Всеволода Змієнка. 8 хв від зупинки громадського транспорту, зручна велопарковка.',
      recommendations: 'Обов’язково скуштуйте крафтовий лимонад із тархуном та свіжий вишневий пиріг.',
    },
  },
  {
    id: 'spot_nova_poshta',
    name: 'Нова Пошта №33',
    category: 'поштове відділення · сервіс',
    address: 'вул. Олександра Олеся',
    distance: '128.8 км',
    walkingTime: '≈ 2060 хв пішки',
    coords: { lat: 50.4512, lng: 30.521 },
    hours: '08:00 – 21:00',
    icon: 'box',
    pinType: 'service',
    x: 18,
    y: 34,
  },
  {
    id: 'spot_med_servis',
    name: 'Мед-сервіс',
    category: 'аптека · охорона здоров’я',
    address: 'вул. Всеволода Змієнка',
    distance: '129.2 км',
    walkingTime: '≈ 2075 хв пішки',
    coords: { lat: 50.452, lng: 30.526 },
    hours: 'Цілодобово',
    icon: 'cross',
    pinType: 'health',
    x: 72,
    y: 18,
  },
  {
    id: 'spot_grafit',
    name: 'Grafit Coffee & Bakery',
    category: 'кав’ярня · свіжа випічка',
    address: 'вул. Олександра Олеся, 4',
    distance: '129.1 км',
    walkingTime: '≈ 2068 хв пішки',
    coords: { lat: 50.449, lng: 30.522 },
    hours: '08:00 – 20:00',
    icon: 'coffee',
    pinType: 'food',
    x: 18,
    y: 44,
  },
  {
    id: 'spot_ebsh',
    name: 'ЕБШ Sport Lab',
    category: 'спортивний клуб · функціональний тренінг',
    address: 'вул. Всеволода Змієнка, 12',
    distance: '129.3 км',
    walkingTime: '≈ 2074 хв пішки',
    coords: { lat: 50.4485, lng: 30.524 },
    hours: '07:00 – 22:00',
    icon: 'dumbbell',
    pinType: 'sport',
    x: 34,
    y: 46,
  },
  {
    id: 'spot_lipinskii',
    name: 'Lipinskii Dental & Care',
    category: 'клініка естетики та турботи',
    address: 'вул. Всеволода Змієнка, 8',
    distance: '129.0 км',
    walkingTime: '≈ 2070 хв пішки',
    coords: { lat: 50.4495, lng: 30.525 },
    hours: '09:00 – 20:00',
    icon: 'tooth',
    pinType: 'service',
    x: 50,
    y: 41,
  },
];

export const InteractiveMapView: React.FC<InteractiveMapViewProps> = ({
  onSelectLocation,
  currentUser,
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeLayer, setActiveLayer] = useState<'streets' | 'satellite' | 'vibes'>('streets');
  const [selectedSpotId, setSelectedSpotId] = useState<string>('spot_b_fresh');

  const friendsApproaching = [
    { name: 'Марта', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80', status: 'На місці', x: 49, y: 39 },
    { name: 'Тарас', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80', status: '3 хв', x: 44, y: 30 },
  ];

  return (
    <div className="relative w-full h-full bg-[#E5E0D5] overflow-hidden select-none flex flex-col">
      {/* Top Floating Geo-Bar */}
      <div className="absolute top-4 left-4 right-16 sm:right-auto z-10 flex items-center gap-2">
        <div className="px-4 py-2 bg-[#FDFCF9]/95 backdrop-blur-md rounded-full border border-[#D8CEBC] shadow-md flex items-center gap-2 text-xs font-semibold text-[#1E2521]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#528A4B] animate-pulse" />
          <span>{currentUser.locationName}</span>
          <span className="text-[#849287]">· Жива карта координації</span>
        </div>
      </div>

      {/* SVG Stylized Map matching the screenshot's palette and buildings */}
      <div className="relative flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full object-cover transition-transform duration-300"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          <defs>
            <pattern id="grid-pattern" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#DCD6C9" strokeWidth="0.3" />
            </pattern>
          </defs>

          {/* Map Base Background */}
          <rect width="100" height="100" fill="#E8E3D8" />
          <rect width="100" height="100" fill="url(#grid-pattern)" />

          {/* Park & Greenery areas */}
          <ellipse cx="48" cy="22" rx="14" ry="7" fill="#DDE4D4" stroke="#CCD5C2" strokeWidth="0.4" strokeDasharray="1,1" />
          <circle cx="18" cy="42" r="5" fill="#DDE4D4" stroke="#CCD5C2" strokeWidth="0.4" strokeDasharray="1,1" />
          <circle cx="34" cy="44" r="4.5" fill="#DDE4D4" stroke="#CCD5C2" strokeWidth="0.4" strokeDasharray="1,1" />
          <ellipse cx="62" cy="44" rx="6" ry="5" fill="#DDE4D4" stroke="#CCD5C2" strokeWidth="0.4" strokeDasharray="1,1" />

          {/* Street Grid - Off-white wide road arteries */}
          {/* Main vertical street: вул. Всеволода Змієнка */}
          <line x1="68" y1="0" x2="68" y2="100" stroke="#F5F1E8" strokeWidth="6" strokeLinecap="round" />
          <line x1="68" y1="0" x2="68" y2="100" stroke="#DFD7C8" strokeWidth="0.5" strokeDasharray="2,2" />

          {/* Cross Street */}
          <path d="M 0 32 Q 50 36 100 28" fill="none" stroke="#F5F1E8" strokeWidth="5.5" />
          <path d="M 0 32 Q 50 36 100 28" fill="none" stroke="#DFD7C8" strokeWidth="0.5" strokeDasharray="2,2" />

          {/* Diagonal secondary roads */}
          <line x1="0" y1="15" x2="45" y2="55" stroke="#F5F1E8" strokeWidth="4" />
          <line x1="45" y1="55" x2="100" y2="70" stroke="#F5F1E8" strokeWidth="4.5" />
          <line x1="20" y1="65" x2="60" y2="100" stroke="#F5F1E8" strokeWidth="3.5" />

          {/* Building footprints (warm grey/taupe angular shapes) */}
          <rect x="55" y="4" width="10" height="14" rx="1" fill="#DDD7CB" stroke="#CCC4B5" strokeWidth="0.4" />
          {/* Road Network */}
          <path d="M 0 50 Q 30 45, 50 50 T 100 50" fill="none" stroke="#F9F7F1" strokeWidth="4" />
          <path d="M 50 0 Q 55 30, 50 50 T 50 100" fill="none" stroke="#F9F7F1" strokeWidth="4" />
          <path d="M 20 20 L 80 80" fill="none" stroke="#162019" strokeWidth="2.5" strokeDasharray="1,1" />

          {/* Buildings */}
          <rect x="35" y="35" width="12" height="10" rx="1" fill="#FDFCF9" stroke="#DDD4C4" strokeWidth="0.5" />
          <rect x="52" y="38" width="15" height="14" rx="1" fill="#FDFCF9" stroke="#DDD4C4" strokeWidth="0.5" />
          <rect x="25" y="55" width="18" height="12" rx="1" fill="#FDFCF9" stroke="#DDD4C4" strokeWidth="0.5" />
        </svg>

        {/* Render Spots Pins */}
        {mapSpots.map((spot) => {
          const isSelected = selectedSpotId === spot.id;
          return (
            <div
              key={spot.id}
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
              onClick={() => {
                soundFx.playTap();
                setSelectedSpotId(spot.id || '');
                onSelectLocation(spot);
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group z-20"
            >
              {/* Pulse ring */}
              {spot.id === 'spot_b_fresh' && (
                <div className="absolute -inset-2.5 rounded-full bg-[#E87A42]/20 animate-ping" />
              )}

              {/* Pin Pill Label */}
              <div
                className={`px-2.5 py-1 rounded-xl shadow-xl border flex items-center gap-1.5 transition-all transform group-hover:scale-105 ${
                  isSelected || spot.id === 'spot_b_fresh'
                    ? 'bg-[#F1EDE3] border-[#E87A42] text-[#1E2521] ring-2 ring-[#E87A42]/40'
                    : 'bg-[#FDFCF9]/95 border-[#F1EDE3] text-[#5F6A60] hover:text-[#1E2521]'
                }`}
              >
                {spot.id === 'spot_b_fresh' ? (
                  <span className="w-5 h-5 rounded-lg bg-[#F9F7F1] text-[#E87A42] flex items-center justify-center text-[10px] font-bold">
                    🛍️
                  </span>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#E87A42]" />
                )}
                <span className="text-[11px] font-bold whitespace-nowrap">
                  {spot.name}
                </span>
              </div>
            </div>
          );
        })}

        {/* Live Friends Pins Approaching */}
        {friendsApproaching.map((friend, idx) => (
          <div
            key={idx}
            style={{ left: `${friend.x}%`, top: `${friend.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex flex-col items-center"
          >
            <div className="relative">
              <img
                src={friend.avatar}
                alt={friend.name}
                className="w-7 h-7 rounded-full object-cover ring-2 ring-[#E87A42] shadow-md"
              />
              <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-[#E87A42] rounded-full ring-1 ring-[#F7F5EE]" />
            </div>
            <span className="mt-0.5 px-1.5 py-0.5 bg-[#FDFCF9] border border-[#F1EDE3] text-[#1E2521] text-[9px] font-semibold rounded-md shadow-sm">
              {friend.name} ({friend.status})
            </span>
          </div>
        ))}
      </div>

      {/* Floating Right Control Pill */}
      <div 
        id="map-floating-pill"
        className="absolute right-4 top-1/2 -translate-y-1/2 z-30 bg-[#FDFCF9]/95 backdrop-blur-md rounded-2xl p-1.5 border border-[#DDD4C4] shadow-xl flex flex-col items-center gap-1.5"
      >
        {/* Car / Drive Mode */}
        <button
          onClick={() => {
            soundFx.playTap();
            useUIStore.getState().toast({ kind: 'info', message: 'Режим автомобільної навігації увімкнено' });
          }}
          className="p-2.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors cursor-pointer"
          title="Автомобільний маршрут"
        >
          <Car className="w-5 h-5" strokeWidth={1.75} />
        </button>

        {/* Layers switch */}
        <button
          onClick={() => {
            soundFx.playTap();
            setActiveLayer(activeLayer === 'streets' ? 'vibes' : 'streets');
          }}
          className={`p-2.5 rounded-xl transition-colors ${
            activeLayer === 'vibes'
              ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4]'
              : 'text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3]'
          }`}
          title="Шари карти"
        >
          <Layers className="w-5 h-5" strokeWidth={1.75} />
        </button>

        {/* Guide / Book info */}
        <button
          onClick={() => {
            soundFx.playChime();
            const bFresh = mapSpots.find((s) => s.id === 'spot_b_fresh');
            if (bFresh) onSelectLocation(bFresh);
          }}
          className="p-2.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors"
          title="Досьє поточного району"
        >
          <BookOpen className="w-5 h-5" strokeWidth={1.75} />
        </button>

        <div className="w-5 h-px bg-[#E6DFD3]" />

        {/* My Location / Target */}
        <button
          onClick={() => {
            soundFx.playTap();
            setZoomLevel(1);
          }}
          className="p-2.5 text-[#E87A42] hover:bg-[#F9F7F1] rounded-xl transition-colors"
          title="Моє місцезнаходження"
        >
          <Compass className="w-5 h-5" strokeWidth={1.75} />
        </button>

        {/* Zoom In / Out */}
        <button
          onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 2))}
          className="p-2 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl"
        >
          <ZoomIn className="w-4 h-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.8))}
          className="p-2 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl"
        >
          <ZoomOut className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Bottom Floating Quick Card for B Fresh */}
      <div className="absolute bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:w-96 z-20 bg-[#FDFCF9]/95 backdrop-blur-md rounded-2xl p-3.5 border border-[#DDD4C4] shadow-2xl flex items-center justify-between gap-3 text-[#1E2521]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#F9F7F1] flex items-center justify-center text-[#E87A42] border border-[#DDD4C4] shrink-0">
            <ShoppingBag className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-[#1E2521] truncate">B Fresh</h3>
            <p className="text-xs text-[#5F6A60] truncate">
              Вулиця Всеволода Змієнка · 129 км
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            soundFx.playChime();
            const bFresh = mapSpots.find((s) => s.id === 'spot_b_fresh');
            if (bFresh) onSelectLocation(bFresh);
          }}
          className="px-3 py-2 bg-[#FCDBC7] hover:bg-[#F9CCA8] text-[#C45318] font-bold text-xs rounded-xl whitespace-nowrap transition-colors shadow-2xs border border-[#F8C1A2]"
        >
          Відкрити досьє ✦
        </button>
      </div>
    </div>
  );
};
