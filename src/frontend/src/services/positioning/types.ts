/**
 * Звідки взялося місце. Порядок у списку — не порядок довіри: приймач
 * буває збреханий, а мережа — ні, тому довіру рахує `fuse`, а не тип.
 */
export type PositionSourceKind =
  | 'gnss'      // супутники на самому ПК (рідкість — плати зазвичай немає)
  | 'phone'     // телефон поруч, його GNSS через пару
  | 'wifi'      // за точками доступу, які видно
  | 'browser'   // геолокація браузера (сама по собі суміш мережі й IP)
  | 'ip'        // тільки IP — найгрубіше, що буває
  | 'manual';   // людина вказала пальцем

export interface PositionCandidate {
  kind: PositionSourceKind;
  lat: number;
  lon: number;
  /** Заявлена похибка в метрах. Саме заявлена — брехати можна і нею. */
  accuracyM: number;
  /** Коли заміряно, мс епохи. */
  at: number;
  /** Швидкість, км/год, якщо джерело її дає. */
  speedKmh?: number;
  /** Людська назва джерела для підпису. */
  label?: string;
  /**
   * Для Wi-Fi: найсильніша видима точка доступу. Велика мережа накриває
   * кілометри, і центр такої мережі — не місце людини.
   */
  strongestAp?: { bssid: string; rssiDbm: number; lat?: number; lon?: number };
}

export type FindingLevel = 'info' | 'warn' | 'alarm';

export interface Finding {
  level: FindingLevel;
  /** Що саме побачили — однією фразою, людською мовою. */
  text: string;
  /** Що з цим робити. Порожньо, якщо робити нічого не треба. */
  hint?: string;
}

export interface FusedPosition {
  lat: number;
  lon: number;
  accuracyM: number;
  at: number;
  /** Джерело, яке перемогло. */
  kind: PositionSourceKind;
  label: string;
  /** 0..1 — наскільки можна спиратись на цю точку. */
  confidence: number;
  /** Усі кандидати, які брали участь, разом із відхиленими. */
  candidates: PositionCandidate[];
  /** Що помітили: розбіжності, застарілість, ознаки підміни. */
  findings: Finding[];
  /** true, коли картина складається на навмисну підміну. */
  spoofSuspected: boolean;
}

export const SOURCE_LABEL: Record<PositionSourceKind, string> = {
  gnss: 'супутники',
  phone: 'телефон',
  wifi: 'Wi-Fi поруч',
  browser: 'браузер',
  ip: 'за IP',
  manual: 'вказано вручну',
};
