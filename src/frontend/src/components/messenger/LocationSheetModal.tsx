import React, { useState } from 'react';
import {
  ShoppingBag,
  Navigation,
  GitFork,
  Bookmark,
  Share2,
  ChevronDown,
  ChevronUp,
  Info,
  MapPin,
  Clock,
  Footprints,
  ExternalLink,
  Users,
  X
} from 'lucide-react';
import { LocationData } from '../../types/messenger';
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

  if (!isOpen || !location) return null;

  const dossier = location.dossier;
  const hasDossier =
    !!dossier &&
    !!(dossier.vibe || dossier.crowdLevel || dossier.transitTips || dossier.recommendations ||
      (dossier.atmosphere && dossier.atmosphere.length > 0));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4 transition-all select-none">
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Main Bottom Sheet in Dark Obsidian Glass */}
      <div 
        id="location-bottom-sheet"
        className="relative w-full max-w-lg bg-[#FDFCF9] rounded-t-3xl sm:rounded-3xl border border-[#DDD4C4] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col z-10 animate-in slide-in-from-bottom duration-300 text-[#1E2521]"
      >
        {/* Top Handle */}
        <div className="pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.2 rounded-full bg-[#28392C]" />
        </div>

        {/* Close Button top-right */}
        <button
          onClick={onClose}
          className="absolute top-3 right-4 p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-full transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Header row: Icon + Name + Category & Distance */}
          <div className="flex items-start gap-3.5">
            {/* Emerald Icon */}
            <div className="w-12 h-12 rounded-2xl bg-[#F9F7F1] flex items-center justify-center text-[#E87A42] shrink-0 shadow-sm border border-[#DDD4C4]">
              <ShoppingBag className="w-6 h-6" />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-[#1E2521] tracking-tight">
                {location.name}
              </h2>
              <p className="text-xs sm:text-sm text-[#5F6A60] mt-0.5 font-normal">
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
              className="col-span-2 py-3 px-4 bg-[#E87A42] hover:bg-[#C25925] active:scale-[0.98] text-[#F7F5EE] font-bold text-sm rounded-2xl flex items-center justify-center gap-2 transition-all shadow-sm"
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
              className="py-2.5 px-2 bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] text-xs font-semibold rounded-2xl flex flex-col items-center justify-center gap-1 border border-[#E6DFD3] transition-colors"
            >
              <GitFork className="w-4 h-4 text-[#E87A42]" />
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
                  ? 'bg-[#183021] text-[#E87A42] border-[#DDD4C4]'
                  : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] border-[#E6DFD3]'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : 'text-[#E87A42]'}`} />
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
              className="flex-1 py-2.5 px-3 bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] text-xs font-semibold rounded-xl flex items-center justify-center gap-2 border border-[#E6DFD3] transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-[#E87A42]" />
              <span>Надіслати картку в бесіду</span>
            </button>

            <button
              id="plan-meetup-btn"
              onClick={() => {
                soundFx.playChime();
                if (onScheduleMeetup) onScheduleMeetup(location);
                onClose();
              }}
              className="py-2.5 px-3 bg-[#F9F7F1] hover:bg-[#233529] text-[#E87A42] text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 border border-[#DDD4C4] transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Збір тут</span>
            </button>
          </div>

          {/* Info Rows */}
          <div className="space-y-2.5 py-2 text-sm border-t border-b border-[#E6DFD3]">
            {(dossier?.bestHours || location.hours) && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-[#5F6A60] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#E87A42]" /> Години роботи
                </span>
                <span className="font-semibold text-[#1E2521]">
                  {dossier?.bestHours || location.hours}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="text-[#5F6A60] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#E87A42]" /> Адреса
              </span>
              <span className="font-medium text-[#1E2521] text-right truncate max-w-[60%]">
                {location.address}
              </span>
            </div>
          </div>

          {/* Досьє локації — лише поля, що прийшли разом із карткою */}
          {hasDossier && (
            <div className="bg-[#FDFCF9] rounded-2xl border border-[#E6DFD3] overflow-hidden">
              <button
                id="toggle-dossier-accordion"
                onClick={() => setIsDossierExpanded(!isDossierExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#F9F7F1] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#E87A42]" />
                  <span className="font-bold text-sm text-[#1E2521]">
                    Досьє локації
                  </span>
                </div>
                {isDossierExpanded ? (
                  <ChevronUp className="w-4 h-4 text-[#5F6A60]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#5F6A60]" />
                )}
              </button>

              {isDossierExpanded && (
                <div className="px-4 pb-4 pt-1 space-y-3 text-xs sm:text-sm text-[#5F6A60]">
                  {dossier?.vibe && (
                    <p className="leading-relaxed text-[#1E2521] bg-[#F7F5EE] p-3 rounded-xl border border-[#E6DFD3]">
                      {dossier.vibe}
                    </p>
                  )}

                  {/* Atmosphere Tag Pills */}
                  {dossier?.atmosphere && dossier.atmosphere.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {dossier.atmosphere.map((tag, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 text-xs bg-[#F7F5EE] text-[#E87A42] font-medium rounded-full border border-[#E6DFD3]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Crowd & Transit notes */}
                  {(dossier?.crowdLevel || dossier?.transitTips) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {dossier?.crowdLevel && (
                        <div className="p-2.5 bg-[#F7F5EE] rounded-xl border border-[#E6DFD3]">
                          <div className="font-semibold text-[#1E2521] mb-1 flex items-center gap-1">
                            <Users className="w-3 h-3 text-[#E87A42]" /> Заповненість
                          </div>
                          <p className="text-[#5F6A60]">{dossier.crowdLevel}</p>
                        </div>
                      )}

                      {dossier?.transitTips && (
                        <div className="p-2.5 bg-[#F7F5EE] rounded-xl border border-[#E6DFD3]">
                          <div className="font-semibold text-[#1E2521] mb-1 flex items-center gap-1">
                            <Footprints className="w-3 h-3 text-[#E87A42]" /> Доступність
                          </div>
                          <p className="text-[#5F6A60] truncate">{dossier.transitTips}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {dossier?.recommendations && (
                    <div className="p-2.5 bg-[#183021] rounded-xl border border-[#DDD4C4] text-xs text-[#E87A42]">
                      <span className="font-bold">Порада:</span> {dossier.recommendations}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Посилання на карту */}
          <div className="pt-2 space-y-1.5 text-xs">
            <div className="text-[11px] font-bold text-[#5F6A60] uppercase tracking-wider">
              НА КАРТІ
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.name + ' ' + location.address)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#E87A42] hover:underline"
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
