import React, { useState } from 'react';
import { Shield, ShieldCheck, Lock, Check, X } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';

export interface ChannelRoleMember {
  id: string;
  name: string;
  avatar: string;
  role: 'owner' | 'admin' | 'contributor' | 'observer';
  canEditCanvas: boolean;
  canPostWidgets: boolean;
  canAccessDrive: boolean;
  canDeleteMessages: boolean;
  canStartHuddle: boolean;
}

interface RoleScopesModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelTitle: string;
}

export const RoleScopesModal: React.FC<RoleScopesModalProps> = ({
  isOpen,
  onClose,
  channelTitle,
}) => {
  useEscapeClose(isOpen, onClose);

  const [members, setMembers] = useState<ChannelRoleMember[]>([
    {
      id: 'u_kiril',
      name: 'Кирило',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      role: 'owner',
      canEditCanvas: true,
      canPostWidgets: true,
      canAccessDrive: true,
      canDeleteMessages: true,
      canStartHuddle: true,
    },
    {
      id: 'u_sanya',
      name: 'Саня (Lead Dev)',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
      role: 'admin',
      canEditCanvas: true,
      canPostWidgets: true,
      canAccessDrive: true,
      canDeleteMessages: true,
      canStartHuddle: true,
    },
    {
      id: 'u_maryna',
      name: 'Марина (Designer)',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
      role: 'contributor',
      canEditCanvas: true,
      canPostWidgets: true,
      canAccessDrive: true,
      canDeleteMessages: false,
      canStartHuddle: true,
    },
    {
      id: 'u_alex',
      name: 'Олександр (Client/QA)',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
      role: 'observer',
      canEditCanvas: false,
      canPostWidgets: false,
      canAccessDrive: true,
      canDeleteMessages: false,
      canStartHuddle: false,
    },
  ]);

  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const togglePermission = (memberId: string, permKey: keyof ChannelRoleMember) => {
    soundFx.playTap();
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId || m.role === 'owner') return m;
        return { ...m, [permKey]: !m[permKey] };
      })
    );
  };

  const changeRole = (memberId: string, newRole: ChannelRoleMember['role']) => {
    soundFx.playTap();
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId || m.role === 'owner') return m;
        const isObserver = newRole === 'observer';
        return {
          ...m,
          role: newRole,
          canEditCanvas: !isObserver,
          canPostWidgets: !isObserver,
          canAccessDrive: true,
          canDeleteMessages: newRole === 'admin',
          canStartHuddle: !isObserver,
        };
      })
    );
  };

  const handleSave = () => {
    soundFx.playSend();
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-[#21261F]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shadow-sm">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#21261F]">
                Контекстні ролі та доступи (Role Scopes)
              </h3>
              <p className="text-xs text-[#6E7568] mt-0.5">
                Простір: <b>{channelTitle}</b> • Гнучке налаштування прав до артефактів
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[440px] overflow-y-auto custom-scrollbar">
          <p className="text-xs text-[#6E7568] leading-relaxed">
            Користувач може бути <i>спостерігачем</i> у загальній гілці, але мати повний доступ до
            редагування Canvas, публікації віджетів та Workspace Drive.
          </p>

          <div className="space-y-3">
            {members.map((m) => (
              <div
                key={m.id}
                className="p-4 rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] space-y-3 hover:border-[#D96C35]/40 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={m.avatar}
                      alt={m.name}
                      className="w-8 h-8 rounded-full object-cover border border-[#E5DEC9]"
                    />
                    <div>
                      <h4 className="text-[13.5px] font-bold text-[#21261F]">{m.name}</h4>
                      <span className="text-[11px] text-[#6E7568]">
                        {m.role === 'owner'
                          ? '👑 Власник простору'
                          : m.role === 'admin'
                          ? '🛡️ Адміністратор'
                          : m.role === 'contributor'
                          ? '✍️ Автор / Розробник'
                          : '👁️ Спостерігач'}
                      </span>
                    </div>
                  </div>

                  {m.role !== 'owner' ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as ChannelRoleMember['role'])}
                      className="bg-white border border-[#E5DEC9] text-xs font-semibold rounded-lg px-2.5 py-1 text-[#21261F] focus:outline-none focus:border-[#D96C35]"
                    >
                      <option value="admin">🛡️ Адмін</option>
                      <option value="contributor">✍️ Розробник</option>
                      <option value="observer">👁️ Спостерігач</option>
                    </select>
                  ) : (
                    <span className="px-2.5 py-1 bg-[#FDF5ED] border border-[#EADCC8] text-[#D96C35] text-[11px] font-bold rounded-lg">
                      Повний ROOT
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#EAE4D7]">
                  <button
                    onClick={() => togglePermission(m.id, 'canEditCanvas')}
                    disabled={m.role === 'owner'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all flex items-center gap-1 ${
                      m.canEditCanvas
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-white text-[#8A9186] border-[#E5DEC9] opacity-60'
                    }`}
                  >
                    {m.canEditCanvas ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    <span>Canvas Редагування</span>
                  </button>

                  <button
                    onClick={() => togglePermission(m.id, 'canPostWidgets')}
                    disabled={m.role === 'owner'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all flex items-center gap-1 ${
                      m.canPostWidgets
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                        : 'bg-white text-[#8A9186] border-[#E5DEC9] opacity-60'
                    }`}
                  >
                    {m.canPostWidgets ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    <span>Мікро-віджети</span>
                  </button>

                  <button
                    onClick={() => togglePermission(m.id, 'canAccessDrive')}
                    disabled={m.role === 'owner'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all flex items-center gap-1 ${
                      m.canAccessDrive
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-white text-[#8A9186] border-[#E5DEC9] opacity-60'
                    }`}
                  >
                    {m.canAccessDrive ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    <span>Workspace Drive</span>
                  </button>

                  <button
                    onClick={() => togglePermission(m.id, 'canStartHuddle')}
                    disabled={m.role === 'owner'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all flex items-center gap-1 ${
                      m.canStartHuddle
                        ? 'bg-cyan-50 text-cyan-700 border-cyan-300'
                        : 'bg-white text-[#8A9186] border-[#E5DEC9] opacity-60'
                    }`}
                  >
                    {m.canStartHuddle ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    <span>Huddles</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between">
          <span className="text-xs text-[#6E7568]">Доступи застосовуються миттєво через RBAC політики</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#6E7568] hover:text-[#21261F]"
            >
              Закрити
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5"
            >
              {saved ? <Check className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>{saved ? 'Збережено ✓' : 'Застосувати матрицю'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
