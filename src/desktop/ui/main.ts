import '@fontsource/space-grotesk/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './tokens.css';
import './film.css';
import './facet.css';

import { HubClient, HubStatus } from './ws';
import { MurmurLane } from './murmur';
import { Sigil } from './sigil';
import { FacetManager, LedgerRow } from './facet/manager';
import { HubEnvelope, StateTransitionPayload, extractText, parseSystemState, toMurmurLine } from './types';

const BACKEND = import.meta.env.AEGIS_BACKEND ?? 'ws://127.0.0.1:8000';
const CHANNELS = ['state', 'chat', 'alert', 'familiar', 'background_events', 'agent.stream'];

const film = document.getElementById('film')!;

const perimeter = document.createElement('div');
perimeter.className = 'perimeter';
film.appendChild(perimeter);

const sigil = new Sigil(film);
const lane = new MurmurLane(film);
const facets = new FacetManager(film);
facets.expose();

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
const activeTasks = new Set<string>();
let lastGoal = 'фонова робота';

function labourText(data: Record<string, unknown>): string {
  const t = extractText(data) ?? (typeof data.goal === 'string' ? data.goal : null);
  return t ? toMurmurLine(t, 64) : '';
}

function row(tone: LedgerRow['tone'], text: string): LedgerRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    tone,
    text,
  };
}

function onAnimaEvent(type: string, data: Record<string, unknown>): void {
  const taskId = typeof data.task_id === 'string' ? data.task_id : null;
  const phrase = labourText(data);
  if (phrase) lastGoal = phrase;

  switch (type) {
    case 'task.started':
    case 'task.promoted_to_background':
      if (taskId) activeTasks.add(taskId);
      facets.ledgerEvent(row('task', `розпочато — ${phrase || 'задача'}`));
      break;
    case 'task.completed':
      if (taskId) activeTasks.delete(taskId);
      facets.ledgerEvent(row('task', `завершено — ${phrase || 'задача'}`));
      break;
    case 'task.failed':
    case 'task.stopped':
    case 'task.timeout':
      if (taskId) activeTasks.delete(taskId);
      facets.ledgerEvent(row('warn', `${type.slice(5)} — ${phrase || 'задача'}`));
      break;
    case 'warning.issued':
      facets.ledgerEvent(row('warn', phrase || 'попередження'));
      break;
    default:
      return; // observation/thinking spam stays out of the Ledger.
  }
  facets.weather(activeTasks.size, lastGoal, activeTasks.size === 0);
  sigil.spark();
}

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
