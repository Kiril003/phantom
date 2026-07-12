import '@fontsource/space-grotesk/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './tokens.css';
import './film.css';

import { HubClient, HubStatus } from './ws';
import { MurmurLane } from './murmur';
import { Sigil } from './sigil';
import { HubEnvelope, StateTransitionPayload, extractText, parseSystemState, toMurmurLine } from './types';

const BACKEND = import.meta.env.AEGIS_BACKEND ?? 'ws://127.0.0.1:8000';
const CHANNELS = ['state', 'chat', 'alert', 'familiar'];

const film = document.getElementById('film')!;

const perimeter = document.createElement('div');
perimeter.className = 'perimeter';
film.appendChild(perimeter);

const sigil = new Sigil(film);
const lane = new MurmurLane(film);

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
    case 'familiar': {
      sigil.pulse();
      break;
    }
  }
}

new HubClient({
  url: `${BACKEND}/ws`,
  channels: CHANNELS,
  onEnvelope,
  onStatus,
}).connect();
