import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBar } from '../core/StatusBar';
import { useSettingsStore } from '../../stores/settingsStore';

export default function SettingsPanel() {
  const navigate = useNavigate();
  const { categories, values, loaded } = useSettingsStore();
  const [activeCategory, setActiveCategory] = React.useState<string>(
    categories[0]?.id ?? ''
  );

  React.useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0].id);
    }
  }, [categories, activeCategory]);

  const activeCat = categories.find((c) => c.id === activeCategory);

  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex flex-col">
      <StatusBar />
      <div className="flex-1 flex overflow-hidden" style={{ height: '572px' }}>
        {/* Sidebar */}
        <aside className="w-[200px] h-full phantom-panel border-r border-phantom-border flex flex-col overflow-y-auto">
          <div className="px-3 py-2 text-phantom-text-dim text-xs tracking-widest border-b border-phantom-border">
            НАЛАШТУВАННЯ
          </div>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`h-[44px] px-3 text-left text-xs flex items-center gap-2 transition-colors ${
                activeCategory === cat.id
                  ? 'text-phantom-cyan bg-phantom-border'
                  : 'text-phantom-text-dim hover:text-phantom-text'
              }`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span>{cat.icon}</span>
              <span className="truncate">{cat.label}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button
            className="h-[44px] px-3 text-xs text-phantom-text-dim hover:text-phantom-text border-t border-phantom-border"
            onClick={() => navigate(-1)}
          >
            ← НАЗАД
          </button>
        </aside>

        {/* Main */}
        <main className="flex-1 h-full overflow-y-auto px-6 py-4">
          {!loaded && (
            <div className="flex items-center justify-center h-full">
              <span className="text-phantom-text-dim text-xs">Завантаження...</span>
            </div>
          )}
          {loaded && activeCat && (
            <>
              <h2 className="text-phantom-text text-sm tracking-widest mb-4">
                {activeCat.icon} {activeCat.label}
              </h2>
              <div className="flex flex-col gap-1">
                {activeCat.settings.map((def) => (
                  <div
                    key={def.key}
                    className="phantom-panel px-4 py-3 flex items-center gap-4 min-h-[44px]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-phantom-text text-xs">{def.label}</div>
                      <div className="text-phantom-text-dim text-xs truncate">{def.description}</div>
                    </div>
                    <div className="text-phantom-cyan text-xs font-mono">
                      {String(values[def.key] ?? def.value)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
