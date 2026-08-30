import React, { useState, useEffect, useRef } from 'react';
import { HIDDEN_COMMAND_IDS } from './modals/hiddenModals';
import {
  Search,
  FileText,
  LayoutDashboard,
  Network,
  Sparkles,
  Terminal,
  Radio,
  SlidersHorizontal,
  CheckCircle2,
  HardDrive,
  Coins,
  Database,
  Zap,
  History,
  Lock,
  Cpu,
  GraduationCap,
  Home,
  Heart,
  Palette,
  Users,
  Boxes,
  Wifi,
  ShieldAlert,
  Brain,
  Activity,
  BatteryCharging,
  Layers,
  GitBranch,
  ShoppingBag,
  Server,
  Compass,
  Flame,
  Moon,
  BarChart3,
  PenTool,
  Kanban,
  LayoutGrid,
  Split,
  Workflow,
  Code2,
  Presentation,
  Target,
  Bot,
} from 'lucide-react';
import { useMessengerStore } from '../../stores/messengerStore';
import { soundFx } from '../../utils/messengerSound';

interface CommandItem {
  id: string;
  category: 'Навігація' | 'Дії' | 'Сфери' | 'AI Агенти' | 'P2P Вузол';
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCanvas?: () => void;
  onOpenTerminal?: () => void;
  onOpenNodeDashboard?: () => void;
  onOpenSpaceVault?: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  onOpenCanvas,
  onOpenTerminal,
  onOpenNodeDashboard,
  onOpenSpaceVault,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useMessengerStore();

  const commands: CommandItem[] = [
    // Навігація
    {
      id: 'nav_canvas',
      category: 'Навігація',
      title: 'Відкрити Canvas простір',
      subtitle: 'Живий документ, канбан та схеми',
      icon: FileText,
      shortcut: 'Tab',
      action: () => {
        onOpenCanvas?.();
        onClose();
      },
    },
    {
      id: 'nav_digest',
      category: 'Навігація',
      title: 'Smart Digest бесіди',
      subtitle: 'Зведення непрочитаного та рішень',
      icon: Sparkles,
      action: () => {
        store.setDigestModalOpen(true);
        onClose();
      },
    },
    {
      id: 'nav_settings',
      category: 'Навігація',
      title: 'Налаштування системи',
      subtitle: 'Безпека, P2P ключі, профіль',
      icon: SlidersHorizontal,
      shortcut: 'Ctrl+,',
      action: () => {
        store.setSettingsModalOpen(true);
        onClose();
      },
    },

    // Дії
    {
      id: 'act_terminal',
      category: 'Дії',
      title: 'Shared Terminal & Code Runner',
      subtitle: 'Виконання JS/TS, Python та Bash у P2P',
      icon: Terminal,
      shortcut: 'Ctrl+`',
      action: () => {
        onOpenTerminal?.();
        onClose();
      },
    },
    {
      id: 'act_vault',
      category: 'Дії',
      title: 'Спільна скарбниця (Multi-sig Vault)',
      subtitle: 'Баунті, мікроплатежі та голосування',
      icon: Coins,
      action: () => {
        onOpenSpaceVault?.();
        onClose();
      },
    },
    {
      id: 'act_automations',
      category: 'Дії',
      title: 'Локальні автоматизації (IFTTT & Stand-ups)',
      subtitle: 'Правила подій, щоденні чекаути та Smart Forms',
      icon: Zap,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-automations'));
        onClose();
      },
    },
    {
      id: 'act_datagrid',
      category: 'Дії',
      title: 'Реляційна база даних (Data Grid)',
      subtitle: 'Таблиці, Канбан, Timeline Gantt та Галерея',
      icon: Database,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-datagrid'));
        onClose();
      },
    },
    {
      id: 'act_timemachine',
      category: 'Дії',
      title: 'CRDT Time Machine (Снапшоти)',
      subtitle: 'Відмотування стану простору на будь-яку дату',
      icon: History,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-timemachine'));
        onClose();
      },
    },
    {
      id: 'act_zerotrace',
      category: 'Дії',
      title: 'Zero-Trace, Підпис Ed25519 & Air-Gap USB',
      subtitle: 'Ефемерна RAM-сесія та фізична синхронізація',
      icon: Lock,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-zerotrace'));
        onClose();
      },
    },
    {
      id: 'act_iot',
      category: 'Дії',
      title: 'IoT & Edge Телеметрія + YubiKey',
      subtitle: 'Живий потік сенсорів та апаратні ключі FIDO2',
      icon: Cpu,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-iot'));
        onClose();
      },
    },
    {
      id: 'act_lifecycle',
      category: 'Дії',
      title: 'Living Spec & Кристалізація знань',
      subtitle: 'Стиснення 48h історії в живий документ та Auto-Pruning',
      icon: Sparkles,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-lifecycle'));
        onClose();
      },
    },
    {
      id: 'act_zeroleak',
      category: 'Дії',
      title: 'True Zero-Leak Security & Duress PIN',
      subtitle: 'Фізична ізоляція баз даних та Persona Routing',
      icon: ShieldAlert,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-zeroleak'));
        onClose();
      },
    },
    {
      id: 'act_wasm',
      category: 'Дії',
      title: 'Embedded WASM Apps & FUSE Drive',
      subtitle: '3D GLTF Viewer, симуляції та монтування диска ОС',
      icon: Boxes,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-wasm'));
        onClose();
      },
    },
    {
      id: 'act_p2pcompute',
      category: 'Дії',
      title: 'P2P Compute Pool & Shamir Backup',
      subtitle: 'Шеринг GPU/NPU та розподілені шарди бекапу',
      icon: HardDrive,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-p2pcompute'));
        onClose();
      },
    },
    {
      id: 'act_ambient',
      category: 'Дії',
      title: 'Ambient Computing & Attention Budgeting',
      subtitle: 'Wi-Fi/Гео тригери сфер та пакетування сповіщень',
      icon: Wifi,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-ambient'));
        onClose();
      },
    },
    {
      id: 'act_bridge',
      category: 'Дії',
      title: 'Universal Bridge Core & Puppeting',
      subtitle: 'Шлюзи Matrix, Nostr, ActivityPub та безсерверний TG/Signal',
      icon: Network,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-bridge'));
        onClose();
      },
    },
    {
      id: 'act_schema',
      category: 'Дії',
      title: 'Кастомні схеми просторів & Віджети',
      subtitle: 'Динамічні форми та Zero-Code Mini Views',
      icon: SlidersHorizontal,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-schema'));
        onClose();
      },
    },
    {
      id: 'act_neuro',
      category: 'Дії',
      title: 'Нейро-ергономіка & Focus Decay',
      subtitle: 'Градієнти шуму та Intent-Based маршрутизація',
      icon: Brain,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-neuro'));
        onClose();
      },
    },
    {
      id: 'act_lora',
      category: 'Дії',
      title: 'LoRa SX1262 Mesh & P2P Рація',
      subtitle: 'Позамережевий радіоканал 868MHz та прямий голосовий ефір',
      icon: Radio,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-lora'));
        onClose();
      },
    },
    {
      id: 'act_semanticbus',
      category: 'Дії',
      title: 'Semantic Bus (Live Pipes & RPC)',
      subtitle: 'Пайпи процесів у Canvas та віддалені RPC виклики',
      icon: Activity,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-semanticbus'));
        onClose();
      },
    },
    {
      id: 'act_projections',
      category: 'Дії',
      title: 'Проекційні шари & Semantic Zoom',
      subtitle: 'Інженерний, менеджерський, клієнтський вигляд та зум',
      icon: Layers,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-projections'));
        onClose();
      },
    },
    {
      id: 'act_governance',
      category: 'Дії',
      title: 'Енергоефективність & Binary Diffing',
      subtitle: 'Battery throttling та ізоляція памʼяті воркерів',
      icon: BatteryCharging,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-governance'));
        onClose();
      },
    },
    {
      id: 'act_gitdevops',
      category: 'Дії',
      title: 'Git-Native DevOps & Code Review',
      subtitle: 'Pull requests, 1-click commit suggestions та CI/CD',
      icon: GitBranch,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-gitdevops'));
        onClose();
      },
    },
    {
      id: 'act_academiclms',
      category: 'Дії',
      title: 'Full Academic LMS & Autograder',
      subtitle: 'Здача робіт з автотестами та жива черга захисту',
      icon: GraduationCap,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-academiclms'));
        onClose();
      },
    },
    {
      id: 'act_corporatehr',
      category: 'Дії',
      title: 'Корпоративний HR & Skill Matrix',
      subtitle: 'Онбординг роадмап та пошук внутрішніх експертів',
      icon: Users,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-corporatehr'));
        onClose();
      },
    },
    {
      id: 'act_commerce',
      category: 'Дії',
      title: 'E-Commerce Вітрина & Sovereign CRM',
      subtitle: 'Каталог, інвойси, оплата та internal tool builder',
      icon: ShoppingBag,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-commerce'));
        onClose();
      },
    },
    {
      id: 'act_headless',
      category: 'Дії',
      title: 'Headless Демон & P2P WireGuard Mesh',
      subtitle: 'Фоновий systemd демон та спільний E2EE буфер обміну',
      icon: Server,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-headless'));
        onClose();
      },
    },
    {
      id: 'act_erp',
      category: 'Дії',
      title: 'Local ERP, Склад & Escrow Угоди',
      subtitle: 'SKU інвентар, податкові відомості та смарт-контракти',
      icon: Boxes,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-erp'));
        onClose();
      },
    },
    {
      id: 'act_secops',
      category: 'Дії',
      title: 'SecOps, Merkle-Аудит & DLP',
      subtitle: 'Захист від витоку даних, водяні знаки та Key Ratchet',
      icon: ShieldAlert,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-secops'));
        onClose();
      },
    },
    {
      id: 'act_research',
      category: 'Дії',
      title: 'Семантичний Атлас & Scientific Notebooks',
      subtitle: '3D Граф знань кафедри та спільні обчислення в просторі',
      icon: Compass,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-research'));
        onClose();
      },
    },
    {
      id: 'act_vfs',
      category: 'Дії',
      title: 'Phantom Runtime & POSIX VFS',
      subtitle: 'Монтована файлова система та Wasm Marketplace',
      icon: Cpu,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-vfs'));
        onClose();
      },
    },
    {
      id: 'act_disaster',
      category: 'Дії',
      title: 'Disaster Recovery & P2P DTN Mesh',
      subtitle: 'Multi-transport failover (Wi-Fi/BLE/LoRa) та кур\'єри даних',
      icon: Radio,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-disaster'));
        onClose();
      },
    },
    {
      id: 'act_warroom',
      category: 'Дії',
      title: 'Autonomous Ops & War Room',
      subtitle: 'Прогностичний аналіз ризиків дедлайну та диспетчер аварій',
      icon: Flame,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-warroom'));
        onClose();
      },
    },
    {
      id: 'act_biocontext',
      category: 'Дії',
      title: 'Cognitive Fatigue & Neural Voice Masking',
      subtitle: 'Захист від вигорання та нейроакустика Huddle дзвінків',
      icon: Moon,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-biocontext'));
        onClose();
      },
    },
    {
      id: 'act_vis3d',
      category: 'Дії',
      title: 'Data-to-Graph & 3D CAD В\'ювер',
      subtitle: 'Інтерактивні графіки, Mermaid схеми та 3D моделі',
      icon: BarChart3,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-vis3d'));
        onClose();
      },
    },
    {
      id: 'act_whiteboard',
      category: 'Дії',
      title: 'Multiplayer Whiteboard & Code Runner',
      subtitle: 'Спільні стікери, курсори колег та Wasm Playground',
      icon: PenTool,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-whiteboard'));
        onClose();
      },
    },
    {
      id: 'act_poker',
      category: 'Дії',
      title: 'Planning Poker & Шкала Ганта',
      subtitle: 'Оцінювання складності задач, таймлайни та віджети',
      icon: Kanban,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-poker'));
        onClose();
      },
    },
    {
      id: 'act_multipane',
      category: 'Дії',
      title: 'Spatial Multi-Pane Workspace & Grid',
      subtitle: '4-віконний тайлінг, Focus Workspace та Activity Heatmaps',
      icon: LayoutGrid,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-multipane'));
        onClose();
      },
    },
    {
      id: 'act_mediaannot',
      category: 'Дії',
      title: 'Waveform Scrubber & Before/After Slider',
      subtitle: 'Аудіо-таймкоди, слайдер дизайнів та PDF анотації',
      icon: Split,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-mediaannotation'));
        onClose();
      },
    },
    {
      id: 'act_breadcrumbs',
      category: 'Дії',
      title: 'Smart Breadcrumbs & Context Peek',
      subtitle: 'Хлібні крихти, плаваючий перегляд та закріплена лінія',
      icon: Compass,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-breadcrumbs'));
        onClose();
      },
    },
    {
      id: 'act_statemachine',
      category: 'Дії',
      title: 'Visual State Machines & Pipeline Tracing',
      subtitle: 'Кінцеві автомати процесів та покрокові таймлайни',
      icon: Workflow,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-statemachine'));
        onClose();
      },
    },
    {
      id: 'act_codediff',
      category: 'Дії',
      title: 'Side-by-Side Code Diff & Math Canvas',
      subtitle: 'Візуальне порівняння коду, формули та Hex Inspector',
      icon: Code2,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-codediff'));
        onClose();
      },
    },
    {
      id: 'act_presentation',
      category: 'Дії',
      title: 'Canvas-to-Slides & Speaker Audio Matrix',
      subtitle: 'Слайд-презентації з Canvas та матриця блокерів',
      icon: Presentation,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-presentation'));
        onClose();
      },
    },
    {
      id: 'act_spotlight',
      category: 'Дії',
      title: 'Live Spotlight & Micro-Bounties',
      subtitle: 'Слідування за ведучим та нагороди за PR блокерів',
      icon: Target,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-spotlight'));
        onClose();
      },
    },
    {
      id: 'act_blueprint',
      category: 'Дії',
      title: 'Phantom OS Architecture Blueprint',
      subtitle: 'Повна специфікація: Block-Node, GitOps, LMS, ERP, Mesh',
      icon: Layers,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-blueprint'));
        onClose();
      },
    },
    {
      id: 'act_agentic',
      category: 'Дії',
      title: 'Agentic Runtime, Wasm Sandbox & Shamir ZK',
      subtitle: 'Security Sentinel, Wasm тести, 3D Spatial Audio, Deep Work та бекап',
      icon: Bot,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-agentic'));
        onClose();
      },
    },
    {
      id: 'act_physical',
      category: 'Дії',
      title: 'WebSerial, Offline GIS, WebGPU & Dead Man',
      subtitle: 'Апаратне налагодження, OpenStreetMap, WGSL шейдери та дипломи W3C',
      icon: Cpu,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:open-physical'));
        onClose();
      },
    },
    {
      id: 'act_huddle',
      category: 'Дії',
      title: 'Розпочати Team Huddle',
      subtitle: 'Фонова аудіокімната співпраці',
      icon: Radio,
      action: () => {
        window.dispatchEvent(new CustomEvent('phantom:start-call', { detail: { video: false } }));
        onClose();
      },
    },

    // AI Агенти
    {
      id: 'ai_synthesis',
      category: 'AI Агенти',
      title: 'AI Chronicler: Звести рішення в Canvas',
      subtitle: 'Автономний аналіз та фіксація домовленостей',
      icon: Sparkles,
      action: () => {
        onOpenCanvas?.();
        window.dispatchEvent(new CustomEvent('phantom:add-to-canvas', {
          detail: { text: 'AI Chronicler: Автоматично зведено останні рішення команди.', type: 'decision' }
        }));
        onClose();
      },
    },
    {
      id: 'ai_review',
      category: 'AI Агенти',
      title: 'AI Code Reviewer',
      subtitle: 'Аналіз безпеки та перевірка знипетів',
      icon: CheckCircle2,
      action: () => {
        onOpenTerminal?.();
        onClose();
      },
    },

    // Сфери
    {
      id: 'sphere_work',
      category: 'Сфери',
      title: 'Сфера: Робота та проекти',
      subtitle: 'Робочі простори, Work OS, спліти, термінали',
      icon: LayoutDashboard,
      action: () => {
        store.switchPersonaSphere('work');
        onClose();
      },
    },
    {
      id: 'sphere_academy',
      category: 'Сфери',
      title: 'Сфера: Навчання & Академія',
      subtitle: 'LaTeX конспекти, дедлайни сесії, Anki flashcards',
      icon: GraduationCap,
      action: () => {
        store.switchPersonaSphere('academy');
        window.dispatchEvent(new CustomEvent('phantom:open-academy'));
        onClose();
      },
    },
    {
      id: 'sphere_family',
      category: 'Сфери',
      title: 'Сфера: Сімʼя & Побут',
      subtitle: 'Спільні списки покупок, сімейний календар, Family Vault',
      icon: Home,
      action: () => {
        store.switchPersonaSphere('family');
        window.dispatchEvent(new CustomEvent('phantom:open-family'));
        onClose();
      },
    },
    {
      id: 'sphere_creative',
      category: 'Сфери',
      title: 'Сфера: Творчість, Медіа & Дизайн',
      subtitle: 'Мудборди, таймкодні ревʼю аудіо/відео, P2P портфоліо',
      icon: Palette,
      action: () => {
        store.switchPersonaSphere('creative');
        window.dispatchEvent(new CustomEvent('phantom:open-creative'));
        onClose();
      },
    },
    {
      id: 'sphere_personal',
      category: 'Сфери',
      title: 'Сфера: Особистий простір & Здоровʼя',
      subtitle: 'Зашифрований щоденник роздумів, трекер звичок, воркаут',
      icon: Heart,
      action: () => {
        store.switchPersonaSphere('personal');
        window.dispatchEvent(new CustomEvent('phantom:open-personal'));
        onClose();
      },
    },
    {
      id: 'sphere_community',
      category: 'Сфери',
      title: 'Сфера: Спільноти, Хобі & Клуби',
      subtitle: 'Discourse форум, івенти з RSVP, демократичний консенсус',
      icon: Users,
      action: () => {
        store.switchPersonaSphere('community');
        window.dispatchEvent(new CustomEvent('phantom:open-community'));
        onClose();
      },
    },

    // P2P Вузол
    {
      id: 'p2p_node',
      category: 'P2P Вузол',
      title: 'Моніторинг домашнього вузла',
      subtitle: 'CPU, RAM, диск, стан портів NAT та піри',
      icon: HardDrive,
      action: () => {
        onOpenNodeDashboard?.();
        onClose();
      },
    },
    {
      id: 'p2p_mesh',
      category: 'P2P Вузол',
      title: 'Діагностика P2P Swarm',
      subtitle: 'Direct DataChannels & Relay Mesh',
      icon: Network,
      action: () => {
        store.setP2PModalOpen(true);
        onClose();
      },
    },
  ];

  // Пункти, що ведуть у зачинені екрани, з переліку зникають. Лишити їх
  // означало б проміняти брехню на мертву кнопку: людина тисне й не отримує
  // нічого. З 58 записів палітри 45 вели саме туди.
  const filtered = commands.filter((c) => !HIDDEN_COMMAND_IDS.has(c.id)).filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase()) ||
    (c.subtitle && c.subtitle.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        soundFx.playTap();
        filtered[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-start justify-center p-4 pt-16 md:pt-24 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="p-3.5 border-b border-[#E8E1D3] flex items-center gap-3 bg-[#FAF8F5]">
          <Search className="w-5 h-5 text-[#D96C35] shrink-0" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Введіть команду, дію або перейдіть до розділу (напр. canvas, terminal, сфера)..."
            className="w-full bg-transparent text-sm font-medium text-[#21261F] focus:outline-none placeholder-[#8A9186]"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-[#EFE9DC] text-[11px] font-mono text-[#6E7568]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8A9186]">
              Команд за запитом «{query}» не знайдено
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    soundFx.playTap();
                    item.action();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                    isSelected ? 'bg-[#FDF5ED] border border-[#D96C35]/30' : 'hover:bg-[#FAF8F2] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-[#D96C35] text-white' : 'bg-[#FAF8F5] text-[#6E7568] border border-[#E5DEC9]'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-bold truncate ${isSelected ? 'text-[#D96C35]' : 'text-[#21261F]'}`}>
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="text-[11px] text-[#6E7568] truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-medium text-[#8A9186] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FAF8F5]">
                      {item.category}
                    </span>
                    {item.shortcut && (
                      <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[#EFE9DC] text-[10px] font-mono text-[#6E7568]">
                        {item.shortcut}
                      </kbd>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span className="flex items-center gap-2">
            <span>↑↓ Навігація</span>
            <span>↵ Виконати</span>
          </span>
          <span className="font-mono">Universal Command Palette</span>
        </div>
      </div>
    </div>
  );
};
