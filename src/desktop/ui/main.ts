import '@fontsource/space-grotesk/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './tokens.css';
import './film.css';
import './facet.css';
import './deep.css';
import './office.css';

import { HubClient, HubStatus } from './ws';
import { OfficeScene } from './office/scene';
import { MurmurLane } from './murmur';
import { Sigil } from './sigil';
import { FacetManager, LedgerRow, MonitorTask } from './facet/manager';
import { Verb } from './facet/types';
import { Deep } from './deep/deep';
import { HubEnvelope, StateTransitionPayload, extractText, parseSystemState, toMurmurLine } from './types';

const BACKEND = import.meta.env.AEGIS_BACKEND ?? 'ws://127.0.0.1:8000';
const CHANNELS = ['state', 'chat', 'alert', 'familiar', 'background_events', 'agent.stream'];

const tauri = (window as { __TAURI__?: any }).__TAURI__;
const invoke: (cmd: string, args?: unknown) => Promise<unknown> =
  tauri?.core?.invoke ?? (async () => undefined);

const film = document.getElementById('film')!;

const office = new OfficeScene(film);

const perimeter = document.createElement('div');
perimeter.className = 'perimeter';
film.appendChild(perimeter);

const sigil = new Sigil(film);
const lane = new MurmurLane(film);
const facets = new FacetManager(film);
facets.expose();

// Name the aimed shard back to the Breath Line, so the operator sees what a
// verb is about to strike.
facets.setTargetReporter((label) => {
  void invoke('facet_targeted', { label });
});

// The Deep (Stratum 3 scaffold): the camera descends *through* the aimed Facet
// and hands the aim back on surfacing, so focus survives the dive.
const deep = new Deep(film, {
  aim: () => facets.aim(),
  restore: (id) => facets.retarget(id),
  recede: () => facets.surfaceRecede(),
  resurface: () => facets.surfaceReturn(),
});

let wasAbsent = false;

function onStatus(status: HubStatus): void {
  const absent = status !== 'open';
  sigil.setAbsent(absent);
  if (status === 'absent' && !wasAbsent) {
    lane.murmur('Звʼязок із ядром втрачено — я поруч, але глухий.', 'entity');
    wasAbsent = true;
  } else if (status === 'open' && wasAbsent) {
    lane.murmur('Ядро знову зі мною.', 'entity');
    wasAbsent = false;
  }
}

// ── ANIMA bridge: task lifecycle → Ledger rows + Weather intensity ──────────
// The engine renders labor as light; here we translate the kernel's task events
// (background_events / agent.stream) into that surface. The in-flight task
// count drives the Weather; each event is one Ledger line.
const activeTasks = new Map<string, MonitorTask>();
const transcript: LedgerRow[] = [];
let completed = 0;
let failed = 0;
let lastGoal = 'фонова робота';

function labourText(data: Record<string, unknown>): string {
  const t = extractText(data) ?? (typeof data.goal === 'string' ? data.goal : null);
  return t ? toMurmurLine(t, 64) : '';
}

function record(tone: LedgerRow['tone'], text: string): LedgerRow {
  const r: LedgerRow = {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    tone,
    text,
  };
  transcript.push(r);
  if (transcript.length > 60) transcript.shift();
  return r;
}

function onAnimaEvent(type: string, data: Record<string, unknown>): void {
  const taskId = typeof data.task_id === 'string' ? data.task_id : null;
  const phrase = labourText(data);
  if (phrase) lastGoal = phrase;

  switch (type) {
    case 'task.started':
    case 'task.promoted_to_background':
      if (taskId) {
        activeTasks.set(taskId, { id: taskId, goal: phrase || 'задача', since: Date.now() });
      }
      facets.ledgerEvent(record('task', `розпочато — ${phrase || 'задача'}`));
      break;
    case 'task.completed':
      if (taskId) activeTasks.delete(taskId);
      completed += 1;
      facets.ledgerEvent(record('task', `завершено — ${phrase || 'задача'}`));
      break;
    case 'task.failed':
    case 'task.stopped':
    case 'task.timeout':
      if (taskId) activeTasks.delete(taskId);
      failed += 1;
      facets.ledgerEvent(record('warn', `${type.slice(5)} — ${phrase || 'задача'}`));
      break;
    case 'warning.issued':
      facets.ledgerEvent(record('warn', phrase || 'попередження'));
      break;
    default:
      return; // observation/thinking spam stays out of the Ledger.
  }
  facets.weather(activeTasks.size, lastGoal, activeTasks.size === 0);
  facets.updateMonitor([...activeTasks.values()]);
  office.setPopulated(activeTasks.size > 0);
  sigil.spark();
}

// ── Commands routed from the Breath Line via Rust (objectives 1 + 2) ────────
// The Film never listens to the keyboard — it only ever receives verbs that the
// Breath Line captured locally and Rust validated against the closed allowlist.
interface AegisCmd {
  action: 'verb' | 'target' | 'spawn' | 'depth';
  verb?: Verb;
  dir?: 1 | -1;
  kind?: 'log' | 'dossier' | 'monitor' | 'answer';
  /** Material: the Feed payload, or the answer body when promoting. */
  text?: string;
  question?: string;
}

function dossierLines(): string[] {
  return [
    `у роботі: ${activeTasks.size}`,
    `завершено: ${completed} · зірвано: ${failed}`,
    `остання праця: ${lastGoal}`,
    `записів у стрічці: ${transcript.length}`,
  ];
}

(window as unknown as { __aegisCmd?: (c: AegisCmd) => void }).__aegisCmd = (cmd) => {
  switch (cmd.action) {
    case 'verb':
      if (cmd.verb) facets.verbOnTarget(cmd.verb, cmd.text);
      break;
    case 'target':
      if (cmd.dir) facets.cycleTarget(cmd.dir);
      break;
    case 'depth':
      if (cmd.dir === 1) deep.descend();
      else if (cmd.dir === -1) deep.ascend();
      break;
    case 'spawn':
      if (cmd.kind === 'log') facets.spawnLog(transcript);
      else if (cmd.kind === 'monitor') facets.spawnMonitor([...activeTasks.values()]);
      else if (cmd.kind === 'dossier') facets.spawnDossier('ANIMA', dossierLines());
      else if (cmd.kind === 'answer') facets.spawnAnswer(cmd.question ?? '', cmd.text ?? '');
      break;
  }
};

function onEnvelope(env: HubEnvelope): void {
  switch (env.channel) {
    case 'state': {
      if (env.type !== 'transition') break;
      const to = parseSystemState((env.data as unknown as StateTransitionPayload).to);
      if (to) sigil.setState(to);
      sigil.pulse();
      break;
    }
    case 'chat': {
      if (env.type === 'message.proactive') {
        const text = extractText(env.data);
        if (text) lane.murmur(toMurmurLine(text), 'entity');
        sigil.pulse();
      } else if (env.type.startsWith('workbench.')) {
        sigil.spark();
      }
      break;
    }
    case 'alert': {
      const text = extractText(env.data);
      if (text) lane.murmur(toMurmurLine(text), 'system');
      sigil.pulse();
      break;
    }
    case 'familiar':
      sigil.pulse();
      break;
    case 'background_events':
    case 'agent.stream':
      onAnimaEvent(env.type, env.data);
      break;
  }
}

new HubClient({
  url: `${BACKEND}/ws`,
  channels: CHANNELS,
  onEnvelope,
  onStatus,
}).connect();
