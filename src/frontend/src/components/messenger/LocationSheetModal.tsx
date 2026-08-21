import React, { useState } from 'react';
import {
  ShoppingBag,
  Navigation,
  GitFork,
  Bookmark,
  Share2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  MapPin,
  Clock,
  Footprints,
  RefreshCw,
  ExternalLink,
  Users,
  X
} from 'lucide-react';
import { LocationData, LocationDossier } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface LocationSheetModalProps {
  location: LocationData | null;
  isOpen: boolean;
  onClose: () => void;
  onShareInChat?: (loc: LocationData) => void;
  onScheduleMeetup?: (loc: LocationData) => void;
}

export const LocationSheetModal: React.FC<LocationSheetModalProps> = ({
  location,
  isOpen,
  onClose,
  onShareInChat,
  onScheduleMeetup,
}) => {
  const [isDossierExpanded, setIsDossierExpanded] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [liveDossier, setLiveDossier] = useState<LocationDossier | null>(
    location?.dossier || null
  );

  if (!isOpen || !location) return null;

  const handleGenerateAiDossier = async () => {
    setIsLoadingAi(true);
    soundFx.playChime();
    try {
      const res = await fetch('/api/gemini/location-dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeName: location.name,
          category: location.category,
          address: location.address,
        }),
      });
      const data = await res.json();
      if (data.dossier) {
        setLiveDossier(data.dossier);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingAi(false);
    }
  };

  const dossier = liveDossier || location.dossier;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4 transition-all select-none">
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Main Bottom Sheet in Dark Obsidian Glass */}
      <div 
        id="location-bottom-sheet"
        className="relative w-full max-w-lg bg-[#121A15] rounded-t-3xl sm:rounded-3xl border border-[#2B3C30] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col z-10 animate-in slide-in-from-bottom duration-300 text-[#E4EDE7]"
      >
        {/* Top Handle */}
        <div className="pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.2 rounded-full bg-[#28392C]" />
        </div>

        {/* Close Button top-right */}
        <button
          onClick={onClose}
          className="absolute top-3 right-4 p-1.5 text-[#8EA093] hover:text-white hover:bg-[#1E2A21] rounded-full transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Header row: Icon + Name + Category & Distance */}
          <div className="flex items-start gap-3.5">
            {/* Emerald Icon */}
            <div className="w-12 h-12 rounded-2xl bg-[#1A261D] flex items-center justify-center text-[#55C778] shrink-0 shadow-sm border border-[#2B3E31]">
              <ShoppingBag className="w-6 h-6" />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {location.name}
              </h2>
              <p className="text-xs sm:text-sm text-[#8EA093] mt-0.5 font-normal">
                {location.category}
              </p>
            </div>
          </div>

          {/* Action Row: Main Emerald Button 'Маршрут' + Action links */}
          <div className="grid grid-cols-4 gap-2 items-center">
            {/* Primary Emerald CTA */}
            <button
              id="route-action-btn"
              onClick={() => {
                soundFx.playChime();
                alert(`Побудовано пішохідний та автомобільний маршрут до: ${location.name} (${location.address})`);
              }}
              className="col-span-2 py-3 px-4 bg-[#55C778] hover:bg-[#46AF68] active:scale-[0.98] text-[#0C120E] font-bold text-sm rounded-2xl flex items-center justify-center gap-2 transition-all shadow-sm"
            >
              <Navigation className="w-4 h-4 fill-current" />
              <span>Маршрут</span>
            </button>

            {/* Via */}
            <button
              id="via-action-btn"
              onClick={() => {
                soundFx.playTap();
                alert('Додано як проміжну точку маршруту');
              }}
              className="py-2.5 px-2 bg-[#141C16] hover:bg-[#18231B] text-[#A4B8AB] hover:text-white text-xs font-semibold rounded-2xl flex flex-col items-center justify-center gap-1 border border-[#223126] transition-colors"
            >
              <GitFork className="w-4 h-4 text-[#55C778]" />
              <span>Через</span>
            </button>

            {/* Save */}
            <button
              id="save-location-btn"
              onClick={() => {
                soundFx.playTap();
                setIsSaved(!isSaved);
              }}
              className={`py-2.5 px-2 text-xs font-semibold rounded-2xl flex flex-col items-center justify-center gap-1 border transition-colors ${
                isSaved
                  ? 'bg-[#183021] text-[#55C778] border-[#2B3E31]'
                  : 'bg-[#141C16] hover:bg-[#18231B] text-[#A4B8AB] hover:text-white border-[#223126]'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : 'text-[#55C778]'}`} />
              <span>{isSaved ? 'Збережено' : 'Зберегти'}</span>
            </button>
          </div>

          {/* Secondary Quick Share in Chat Button */}
          <div className="flex items-center gap-2">
            <button
              id="share-chat-btn"
              onClick={() => {
                soundFx.playSend();
                if (onShareInChat) onShareInChat(location);
                onClose();
              }}
              className="flex-1 py-2.5 px-3 bg-[#141C16] hover:bg-[#18231B] text-[#A4B8AB] hover:text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 border border-[#223126] transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-[#55C778]" />
              <span>Надіслати картку в бесіду</span>
            </button>

            <button
              id="plan-meetup-btn"
              onClick={() => {
                soundFx.playChime();
                if (onScheduleMeetup) onScheduleMeetup(location);
                onClose();
              }}
              className="py-2.5 px-3 bg-[#1A261D] hover:bg-[#233529] text-[#55C778] text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 border border-[#2B3E31] transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Збір тут</span>
            </button>
          </div>

          {/* Info Rows */}
          <div className="space-y-2.5 py-2 text-sm border-t border-b border-[#1F2B22]">
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="text-[#8EA093] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#55C778]" /> Години роботи
              </span>
              <span className="font-semibold text-white">
                {dossier?.bestHours || location.hours || '08:30 – 22:00'}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="text-[#8EA093] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#55C778]" /> Адреса
              </span>
              <span className="font-medium text-white text-right truncate max-w-[60%]">
                {location.address}
              </span>
            </div>
          </div>

          {/* Signature Gemini AI "Досьє локації" Accordion */}
          <div className="bg-[#141C16] rounded-2xl border border-[#223126] overflow-hidden">
            <button
              id="toggle-dossier-accordion"
              onClick={() => setIsDossierExpanded(!isDossierExpanded)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#18231B] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#55C778]" />
                <span className="font-bold text-sm text-white">
                  ✦ Досьє локації
                </span>
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-[#183021] text-[#55C778] border border-[#2B3E31] rounded-full">
                  Gemini AI
                </span>
              </div>
              {isDossierExpanded ? (
                <ChevronUp className="w-4 h-4 text-[#8EA093]" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#8EA093]" />
              )}
            </button>

            {isDossierExpanded && (
              <div className="px-4 pb-4 pt-1 space-y-3 text-xs sm:text-sm text-[#A4B8AB]">
                {/* Vibe description */}
                <p className="leading-relaxed text-[#D1DFD6] bg-[#0E1410] p-3 rounded-xl border border-[#1F2B22]">
                  {dossier?.vibe ||
                    'Сучасний простір із фокусом на натуральні продукти, свіжу каву та спокійну атмосферу для зустрічей.'}
                </p>

                {/* Atmosphere Tag Pills */}
                {dossier?.atmosphere && dossier.atmosphere.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {dossier.atmosphere.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 text-xs bg-[#0E1410] text-[#55C778] font-medium rounded-full border border-[#223126]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Crowd & Transit notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-[#0E1410] rounded-xl border border-[#1F2B22]">
                    <div className="font-semibold text-white mb-1 flex items-center gap-1">
                      <Users className="w-3 h-3 text-[#55C778]" /> Заповненість
                    </div>
                    <p className="text-[#8EA093]">
                      {dossier?.crowdLevel || 'Помірний трафік'} (найкраще: 11:00-15:00)
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#0E1410] rounded-xl border border-[#1F2B22]">
                    <div className="font-semibold text-white mb-1 flex items-center gap-1">
                      <Footprints className="w-3 h-3 text-[#55C778]" /> Доступність
                    </div>
                    <p className="text-[#8EA093] truncate">
                      {dossier?.transitTips || 'Зручно пішки та на авто'}
                    </p>
                  </div>
                </div>

                {/* Secret Recommendation */}
                {dossier?.recommendations && (
                  <div className="p-2.5 bg-[#183021] rounded-xl border border-[#2B3E31] text-xs text-[#55C778]">
                    <span className="font-bold">Порада від Gemini:</span> {dossier.recommendations}
                  </div>
                )}

                {/* Regenerate with AI button */}
                <button
                  onClick={handleGenerateAiDossier}
                  disabled={isLoadingAi}
                  className="w-full py-2 px-3 bg-[#141C16] hover:bg-[#18231B] text-white font-semibold text-xs rounded-xl border border-[#223126] flex items-center justify-center gap-1.5 transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#55C778] ${isLoadingAi ? 'animate-spin' : ''}`} />
                  <span>{isLoadingAi ? 'Аналізую локацію...' : 'Оновити досьє через Gemini'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Proximity and OpenStreetMap footer from screenshot */}
          <div className="pt-2 space-y-1.5 text-xs">
            <div className="text-[11px] font-bold text-[#8EA093] uppercase tracking-wider">
              ПОРУЧ
            </div>
            <p className="text-[#6B8072] text-[11px]">
              Дані зіставлено з OpenStreetMap & Gemini Location Intelligence
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.name + ' ' + location.address)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#55C778] hover:underline"
            >
              <span>{location.address}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
