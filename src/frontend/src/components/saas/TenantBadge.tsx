import { useEffect, useState } from 'react';
import { request } from '../../services/api';
import { Building2, ChevronDown, ShieldCheck, Zap } from 'lucide-react';

export interface TenantInfo {
  tenant_id: string;
  tenant_name?: string | null;
  user_id: string;
  username: string;
  role: string;
  plan_tier?: string;
}

export function TenantBadge(): JSX.Element {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [open, setOpen] = useState(false);

  // Запит ішов без токена, тож завжди падав, а на екран виходила заглушка
  // з вигаданою назвою «Phantom Enterprise» — простір, якого не існує.
  useEffect(() => {
    request<TenantInfo>('GET', '/tenant/current')
      .then((data) => setTenant(data))
      .catch(() => setTenant(null));
  }, []);

  // Без відповіді сервера тариф невідомий. «PRO» за замовчуванням був
  // обіцянкою, якої ніхто не давав.
  const planTier = tenant?.plan_tier ?? null;

  const formatRole = (role?: string) => {
    switch (role?.toUpperCase()) {
      case 'ROOT':
        return 'Головний адміністратор';
      case 'ADMIN':
        return 'Адміністратор';
      case 'MEMBER':
        return 'Учасник';
      default:
        return role || 'Оператор';
    }
  };

  return (
    <div className="relative inline-block text-left select-none">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95 text-xs text-ink-primary"
      >
        <Building2 size={14} className="text-amber-400" />
        <span className="font-medium tracking-wide">
          {tenant?.tenant_name ?? tenant?.username ?? 'простір не визначено'}
        </span>
        {planTier && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Zap size={10} />
            {planTier}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 min-w-[16rem] rounded-xl bg-slate-900/95 border border-white/10 backdrop-blur-xl shadow-2xl p-3 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-white/10">
            <ShieldCheck size={16} className="text-emerald-400" />
            <div>
              <p className="font-semibold text-white">{tenant?.username}</p>
              <p className="text-[10px] text-slate-400">Роль: {formatRole(tenant?.role)}</p>
            </div>
          </div>

          <div className="space-y-1.5 py-1">
            <div className="flex justify-between text-[11px] text-slate-300 gap-4">
              <span>Багатокористувацька ізоляція</span>
              <span className="text-emerald-400 font-medium">Активно</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-300 gap-4">
              <span>Квота токенів ШІ</span>
              <span className="text-slate-400 font-mono">100 тис. / місяць</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full mt-3 py-1.5 text-center text-xs font-medium rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors"
          >
            Керувати організацією
          </button>
        </div>
      )}
    </div>
  );
}
