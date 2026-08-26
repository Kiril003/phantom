import React, { useState } from 'react';
import {
  Users,
  MessageSquare,
  MapPin,
  Plus,
  X,
  ThumbsUp,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ForumTopic {
  id: string;
  category: 'Урбаністика' | 'Книжковий клуб' | 'Геймінг';
  title: string;
  repliesCount: number;
  lastActive: string;
  author: string;
}

interface CommunityEvent {
  id: string;
  title: string;
  date: string;
  location: string;
  attendeesCount: number;
  isRSVPed: boolean;
}

interface CommunityProposal {
  id: string;
  title: string;
  votesFor: number;
  votesAgainst: number;
  status: 'Голосування триває' | 'Прийнято';
}

interface CommunityClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CommunityClubModal: React.FC<CommunityClubModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Міська спільнота & Клуб',
}) => {
  const [activeTab, setActiveTab] = useState<'forum' | 'events' | 'consensus'>('forum');

  const [topics] = useState<ForumTopic[]>([
    {
      id: 't1',
      category: 'Урбаністика',
      title: 'Облаштування безбарʼєрного пішохідного переходу біля скверу',
      repliesCount: 28,
      lastActive: '15 хв тому',
      author: 'Олексій',
    },
    {
      id: 't2',
      category: 'Книжковий клуб',
      title: 'Обговорення книги "Суверенна особистість" (Девідсон та Ріс-Могг)',
      repliesCount: 14,
      lastActive: '2 год тому',
      author: 'Марина',
    },
    {
      id: 't3',
      category: 'Геймінг',
      title: 'Локальний P2P турнір зі стратегій у ці вихідні',
      repliesCount: 9,
      lastActive: 'Вчора',
      author: 'Саня',
    },
  ]);

  const [events, setEvents] = useState<CommunityEvent[]>([
    {
      id: 'ev1',
      title: 'Міська архітектурна прогулянка Подолом',
      date: '30 Серпня, 17:00',
      location: 'Контрактова площа (біля фонтану)',
      attendeesCount: 19,
      isRSVPed: true,
    },
    {
      id: 'ev2',
      title: 'Зустріч книжкового клубу: Живий розбір',
      date: '03 Вересня, 19:00',
      location: 'Локальний хаб / Онлайн стрім',
      attendeesCount: 12,
      isRSVPed: false,
    },
  ]);

  const [proposals, setProposals] = useState<CommunityProposal[]>([
    {
      id: 'prop1',
      title: 'Встановлення сонячної батареї для автономного освітлення підʼїзду',
      votesFor: 32,
      votesAgainst: 3,
      status: 'Голосування триває',
    },
    {
      id: 'prop2',
      title: 'Спільна закупівля саджанців для озеленення подвірʼя',
      votesFor: 45,
      votesAgainst: 1,
      status: 'Прийнято',
    },
  ]);

  if (!isOpen) return null;

  const toggleRSVP = (id: string) => {
    soundFx.playTap();
    setEvents(
      events.map((ev) => {
        if (ev.id === id) {
          const isRSVPed = !ev.isRSVPed;
          return {
            ...ev,
            isRSVPed,
            attendeesCount: isRSVPed ? ev.attendeesCount + 1 : ev.attendeesCount - 1,
          };
        }
        return ev;
      })
    );
  };

  const voteForProposal = (id: string) => {
    soundFx.playSend();
    setProposals(
      proposals.map((p) => (p.id === id ? { ...p, votesFor: p.votesFor + 1 } : p))
    );
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#F5F3FF] border-b border-[#DDD6FE] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white text-purple-700 border border-purple-200 shadow-2xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-purple-950">
                Сфера: Спільноти, Хобі & Клуби · {chatTitle}
              </h3>
              <p className="text-[11px] text-purple-800">
                Форумні розділи Discourse-стилю, RSVP подій та демократичний консенсус
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-purple-100 p-0.5 rounded-lg text-xs font-medium text-purple-900">
              <button
                onClick={() => setActiveTab('forum')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'forum' ? 'bg-white text-purple-950 font-bold shadow-2xs' : 'hover:text-purple-950'
                }`}
              >
                Форум ({topics.length})
              </button>
              <button
                onClick={() => setActiveTab('events')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'events' ? 'bg-white text-purple-950 font-bold shadow-2xs' : 'hover:text-purple-950'
                }`}
              >
                Події & RSVP
              </button>
              <button
                onClick={() => setActiveTab('consensus')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'consensus' ? 'bg-white text-purple-950 font-bold shadow-2xs' : 'hover:text-purple-950'
                }`}
              >
                Голосування
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-purple-200/50 rounded-lg text-purple-900 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Forum Categories */}
          {activeTab === 'forum' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Тематичні гілки обговорень спільноти</h4>
                <button
                  onClick={() => soundFx.playTap()}
                  className="px-3 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Нова тема</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {topics.map((t) => (
                  <div key={t.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs hover:bg-[#FAF8F5] transition-colors cursor-pointer">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-purple-800 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                          {t.category}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{t.title}</h5>
                      </div>
                      <p className="text-[10px] text-[#8A9186]">Автор: @{t.author} · Активність: {t.lastActive}</p>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-[#6E7568] bg-[#FAF8F5] px-2.5 py-1 rounded-lg border border-[#E8E1D3]">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span className="font-bold font-mono">{t.repliesCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Events & RSVP */}
          {activeTab === 'events' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Найближчі зустрічі та заходи</h4>
              <div className="space-y-3">
                {events.map((ev) => (
                  <div key={ev.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2.5 shadow-2xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h5 className="font-bold text-xs text-[#21261F]">{ev.title}</h5>
                        <p className="text-[11px] text-purple-800 font-semibold mt-0.5">{ev.date}</p>
                        <p className="text-[10px] text-[#6E7568] flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-red-500" />
                          <span>{ev.location}</span>
                        </p>
                      </div>

                      <button
                        onClick={() => toggleRSVP(ev.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          ev.isRSVPed
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] text-[#21261F]'
                        }`}
                      >
                        {ev.isRSVPed ? '✓ Я йду' : 'Приєднатися'} ({ev.attendeesCount})
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Consensus & Voting */}
          {activeTab === 'consensus' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Демократичні ініціативи та консенсус</h4>
              <div className="space-y-3">
                {proposals.map((prop) => (
                  <div key={prop.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2.5 shadow-2xs">
                    <div className="flex items-start justify-between gap-2">
                      <h5 className="font-bold text-xs text-[#21261F]">{prop.title}</h5>
                      <span className="text-[10px] font-bold text-purple-800 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                        {prop.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-emerald-700">За: {prop.votesFor}</span>
                        <span className="text-[#8A9186]">Проти: {prop.votesAgainst}</span>
                      </div>

                      <button
                        onClick={() => voteForProposal(prop.id)}
                        className="flex items-center gap-1 px-3 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                      >
                        <ThumbsUp className="w-3 h-3" />
                        <span>Підтримати</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#F5F3FF] border-t border-[#DDD6FE] flex items-center justify-between text-[11px] text-purple-950">
          <span>Суверенна самоорганізація спільнот</span>
          <span className="font-mono">Quadratic Voting Ready</span>
        </div>
      </div>
    </div>
  );
};
