/** The specialist catalog, mirrored from `src/backend/agent/team/specialists.py`
 *  — 5 team leads + 18 seniors across 5 departments. A role that is not in this
 *  table has no department we can source, so its agent works in the lobby. */

import { ZoneId } from './layout';

export const DEPARTMENT_OF_ROLE: Readonly<Record<string, ZoneId>> = {
  team_lead_engineering: 'engineering',
  team_lead_product: 'product',
  team_lead_qa: 'qa',
  team_lead_research: 'research',
  team_lead_operations: 'operations',

  senior_architect: 'engineering',
  senior_backend: 'engineering',
  senior_frontend: 'engineering',
  senior_security: 'engineering',
  senior_devops: 'engineering',
  senior_perf: 'engineering',

  product_manager: 'product',
  ux_researcher: 'product',
  designer: 'product',

  senior_test: 'qa',
  pen_tester: 'qa',
  manual_qa: 'qa',

  domain_researcher: 'research',
  data_analyst: 'research',
  osint: 'research',

  incident_responder: 'operations',
  documentation_writer: 'operations',
  translator: 'operations',
};

export const DEPARTMENTS: readonly ZoneId[] = [
  'engineering',
  'product',
  'qa',
  'research',
  'operations',
];

/** "Product Manager", "senior-backend" and "SENIOR_BACKEND" are one key. */
export function normaliseRole(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function departmentOf(role: string | null): ZoneId | null {
  if (!role) return null;
  return DEPARTMENT_OF_ROLE[normaliseRole(role)] ?? null;
}

export function isDepartment(name: string): name is ZoneId {
  return (DEPARTMENTS as readonly string[]).includes(normaliseRole(name));
}
