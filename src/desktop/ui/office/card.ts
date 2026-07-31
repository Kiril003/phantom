/** The card that names the character the operator is looking at. Read-only —
 *  it reports the task, it never commands it. Every line is a field the kernel
 *  broadcast; a field it never sent is simply absent. */

import { Agent, Posture } from './reducer';
import { zone } from './layout';

const POSTURE_UA: Readonly<Record<Posture, string>> = {
  arriving: 'заходить',
  working: 'працює',
  thinking: 'думає',
  reflecting: 'осмислює',
  blocked: 'заблоковано',
  waiting_user: 'чекає на тебе',
  failed: 'зірвано',
  leaving: 'виходить',
};

const OUTCOME_UA: Readonly<Record<string, string>> = {
  done: 'завершено',
  failed: 'провал',
  stopped: 'зупинено',
  timeout: 'таймаут',
};

function elapsed(since: number): string {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} хв` : `${Math.floor(m / 60)} год ${m % 60} хв`;
}

export class AgentCard {
  private readonly node: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.node = document.createElement('div');
    this.node.className = 'office-card';
    root.appendChild(this.node);
  }

  hide(): void {
    this.node.classList.remove('visible');
  }

  show(agent: Agent): void {
    const dept = zone(agent.zone);
    const rows: [string, string][] = [
      ['стан', POSTURE_UA[agent.posture]],
      ['відділ', dept.label.toLowerCase()],
      ['потік', agent.track === 'background' ? 'фон' : 'перед оператором'],
    ];
    if (agent.detail) rows.push(['зараз', agent.detail]);
    if (agent.subGoal) rows.push(['під-ціль', agent.subGoal]);
    if (agent.step > 0) rows.push(['крок', String(agent.step)]);
    if (agent.missionId) rows.push(['місія', agent.missionId.slice(0, 8)]);
    if (agent.parentTaskId) rows.push(['від', agent.parentTaskId.slice(0, 8)]);
    if (agent.outcome) rows.push(['підсумок', OUTCOME_UA[agent.outcome] ?? agent.outcome]);
    rows.push(['на поверсі', elapsed(agent.since)]);
    if (agent.unattributed) rows.push(['джерело', 'застав у роботі']);

    this.node.replaceChildren(
      el('div', 'office-card-role', agent.role ?? 'задача оператора'),
      el('div', 'office-card-goal', agent.goal || '—'),
      rows.reduce((list, [k, v]) => {
        list.append(el('dt', '', k), el('dd', '', v));
        return list;
      }, document.createElement('dl')),
      el('div', 'office-card-id', agent.taskId.slice(0, 8)),
    );
    this.node.style.setProperty('--office-card-accent', `#${dept.accent.toString(16).padStart(6, '0')}`);
    this.node.classList.add('visible');
  }

  dispose(): void {
    this.node.remove();
  }
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
}
