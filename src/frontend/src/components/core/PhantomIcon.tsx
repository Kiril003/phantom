import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  AlarmClock,
  ArrowUp,
  AudioLines,
  BellRing,
  Brain,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleStop,
  Circle,
  CircuitBoard,
  Clock,
  CloudCheck,
  CloudOff,
  Download,
  Ellipsis,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  Footprints,
  Heart,
  HelpCircle,
  House,
  LayoutGrid,
  LoaderCircle,
  Map,
  MapPin,
  MemoryStick,
  MessagesSquare,
  Mic,
  Moon,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  Radar,
  RadioTower,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  ShieldHalf,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Thermometer,
  Timer,
  Trash2,
  Utensils,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

/**
 * Material-Symbols ligature name → lucide component.
 *
 * The one place the old CDN icon-font names are resolved. Because data
 * structures across the app carry `icon: 'timer'`-style ligature strings
 * (tabs, tools, scenes), keeping this string-keyed map lets those fields stay
 * untouched — a call site is just `<PhantomIcon name={tab.icon} />`. Only the
 * icons actually used in the tree are imported, so the bundle carries exactly
 * this set and nothing more (no `dynamicIconImports`, which would pull all
 * ~1,500 icons). Every mapping was verified against the installed lucide-react.
 */
const ICONS: Record<string, LucideIcon> = {
  add: Plus,
  alarm: AlarmClock,
  apps: LayoutGrid,
  arrow_upward: ArrowUp,
  auto_awesome: Sparkles,
  bedtime: Moon,
  business_center: Briefcase,
  calendar_view_week: CalendarRange,
  cell_tower: RadioTower,
  check_circle: CircleCheck,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  close: X,
  cloud_done: CloudCheck,
  cloud_off: CloudOff,
  delete: Trash2,
  description: FileText,
  developer_board: CircuitBoard,
  device_thermostat: Thermometer,
  directions_walk: Footprints,
  download: Download,
  edit: Pencil,
  error: CircleAlert,
  event: CalendarDays,
  favorite: Heart,
  folder: Folder,
  folder_open: FolderOpen,
  forum: MessagesSquare,
  grid_view: LayoutGrid,
  home: House,
  location_city: Building2,
  map: Map,
  memory: MemoryStick,
  mic: Mic,
  more_horiz: Ellipsis,
  music_note: Music,
  notifications_active: BellRing,
  pause: Pause,
  place: MapPin,
  play_arrow: Play,
  power_settings_new: Power,
  progress_activity: LoaderCircle,
  psychology: Brain,
  psychology_alt: Brain,
  radar: Radar,
  radio_button_unchecked: Circle,
  remove_circle_outline: CircleMinus,
  replay: RotateCcw,
  restaurant: Utensils,
  save: Save,
  schedule: Clock,
  search: Search,
  settings_voice: AudioLines,
  shield_lock: ShieldCheck,
  shield_moon: ShieldHalf,
  stop_circle: CircleStop,
  terminal: Terminal,
  timer: Timer,
  tune: SlidersHorizontal,
  visibility_off: EyeOff,
  wb_sunny: Sun,
  wifi: Wifi,
  wifi_off: WifiOff,
};

/** Material Symbols `wght` axis → nearest lucide stroke width. */
function weightToStroke(weight?: number): number | undefined {
  if (weight === undefined) return undefined;
  if (weight <= 300) return 1.5;
  if (weight <= 400) return 2;
  if (weight <= 500) return 2.25;
  return 2.5;
}

export interface PhantomIconProps extends Omit<LucideProps, 'ref'> {
  /** Former Material-Symbols ligature name, e.g. `"close"`, `"timer"`. */
  name: string;
  /**
   * Material Symbols `wght`-axis parity (300/400/500/600). Mapped to lucide
   * `strokeWidth`. Ignored when `strokeWidth` is passed explicitly.
   */
  weight?: number;
  /** Material Symbols `FILL 1` parity — paint the glyph with `currentColor`. */
  filled?: boolean;
}

/**
 * Renders a lucide icon by its former Material-Symbols ligature name, the
 * drop-in replacement for the old icon-font `<span>` glyphs.
 *
 * An unmapped name degrades to a visible placeholder plus a dev-only warning
 * rather than a blank box or a crash — a missed mapping is loud in development
 * and harmless in production. Standard lucide props (`size`, `color`,
 * `className`, `style`, `aria-*`) pass straight through.
 */
export function PhantomIcon({
  name,
  size = 20,
  weight,
  filled,
  strokeWidth,
  fill,
  ...rest
}: PhantomIconProps) {
  const Cmp = ICONS[name];
  const resolvedStroke = strokeWidth ?? weightToStroke(weight);
  // Material Symbols тримали FILL як варіацію шрифту — заливка була частиною
  // гліфа. Lucide контурний, тож суцільний currentColor перетворював іконку на
  // чорну пляму. Легка заливка лишає силует читабельним.
  const resolvedFill = fill ?? (filled ? 'currentColor' : 'none');
  const resolvedFillOpacity = resolvedFill === 'currentColor' ? 0.18 : undefined;

  if (!Cmp) {
    if (import.meta.env.DEV) {
       
      console.warn(`[PhantomIcon] unmapped icon name: "${name}"`);
    }
    return <HelpCircle size={size} strokeWidth={resolvedStroke} fill={resolvedFill} fillOpacity={resolvedFillOpacity} {...rest} />;
  }
  return <Cmp size={size} strokeWidth={resolvedStroke} fill={resolvedFill} fillOpacity={resolvedFillOpacity} {...rest} />;
}

export default PhantomIcon;
