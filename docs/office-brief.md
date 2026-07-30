# The Office — agentic execution you can watch

## What this is

PHANTOM OS runs real agents: a kernel that starts tasks, a specialist registry of
23 roles across 5 departments, sub-agents that delegate to each other and pass
messages. Today the operator sees that as a scrolling text ledger. This replaces
it with a room they can look at: a 3D office floor where each running agent is a
character that walks, sits at a desk, works, and carries results to whoever asked.

The point is not decoration. The point is that a glance answers *who is working
on what, and how far along* — faster than reading forty lines of log.

## The one law

**Nothing moves that did not happen.**

Every character on that floor stands for a live task or sub-agent in the kernel.
Every walk, every handover, every desk light corresponds to one event that the
backend actually broadcast. No idle crowd, no ambient extras, no simulated
activity to make the scene look busy. When the kernel is idle the office is
empty and lit low — that emptiness is the honest empty state, and it is what the
operator sees most of the time.

If you cannot source a movement from an event below, it does not go in.

## The events you have

Channels: `agent.stream` (foreground) and `background_events` (background tasks).
Both already subscribed by `src/desktop/ui/main.ts`. Envelope shape is in
`src/desktop/ui/types.ts`; the client is `src/desktop/ui/ws.ts`.

Emitted by `src/backend/agent/kernel/runtime.py` and friends:

    task.started                    task.paused                task.resumed
    task.promoted_to_background     task.waiting_user          task.report_ready
    task.blocked_quota              task.blocked_quota_backoff task.safety_changed
    task.intervention_received      task.resumed_from_crash
    mission.started                 mission.phase_started      mission.phase_completed
    mission.completed               mission.failed
    sub_goal.started                sub_goal.done              sub_goal.abandoned
    plan.step_created               plan.architectural_decision plan.user_edited
    strategic_plan.created
    thinking.started                thinking.completed
    action.started                  tool.selected
    observation.added               reflection.started         reflection.completed
    checkpoint.created              team.message
    agent.budget.warning            agent.resumed_with_caveat  warning.issued
    system.install_dependency       system.memory_compressed

`team.message` (`src/backend/agent/kernel/audit.py:404`) is the one that carries
agent-to-agent traffic — that is your handover animation, and the only honest
source for one character walking to another.

Read the payload shapes before you map them. `task_id` is the identity that
persists across a task's life; hold characters in a `Map<task_id, Character>`.

## The floor

Departments come from `src/backend/agent/team/specialists.py` — read it, do not
invent: `engineering`, `product`, `qa`, `research`, `operations`, five team-lead
roles plus eighteen seniors. Five work zones plus a lobby. A spawned specialist
walks to its department's zone; a foreground task the operator started works in
the lobby, in view.

Layout is data, not hardcoded geometry scattered through the renderer: one
module that owns zone rectangles and desk slots, so the floor can be re-shaped
without touching the character code.

## Build constraints

- **Everything local.** `three` as an npm dependency bundled by vite. No CDN, no
  remote asset fetch at runtime, no external font or texture host. The Film runs
  on a machine that may have no internet.
- **Characters**: CC0 / public-domain glTF only, committed into the repo, with a
  `SOURCES.md` naming each file's origin and licence. If you cannot find rigged
  CC0 characters small enough to commit, build stylised low-poly figures in code
  (capsule + limbs, procedural walk cycle) rather than pulling a remote asset —
  a clean stylised figure beats a broken download.
- **Performance**: this renders on top of a desktop the operator is using. Cap
  the frame budget, drop to a still frame when the office is empty, and stop the
  render loop entirely when the surface is not visible. No per-frame allocation.
- **Tests**: vitest, already configured (`npm test`). The event→office-state
  reducer must be pure and tested — given this sequence of envelopes, this is
  who is on the floor, where, and doing what. Rendering is not unit-tested;
  the reducer is, thoroughly, including out-of-order and orphan events.
- **No comments unless the line is genuinely surprising.** The code says what it
  does; a comment earns its place only by saying why.

## Discipline

Work is dirty in this repo — other people's changes are in the tree. **Commit by
explicit path, never `git add -A`.** Commit every working increment, small, with
a message that says what the operator can now see. If a limit kills the session,
the next one must be able to pick up from a commit, not from your memory.

Order of work, each one committed before the next starts:

1. `three` installed, an empty lit office floor rendering in the Film, render
    loop stopping when hidden.
2. The reducer: envelopes in, office state out, tested.
3. One character per live task, standing at the right desk. Still, no walk.
4. Walk cycle and pathing between lobby and zones.
5. `team.message` handover between two characters.
6. State on the body: thinking, blocked, waiting for the operator, failed.
7. Camera the operator can move; click a character, see the task it is.

Stop at any numbered step and the office is still honest and still shippable.
That is the point of the order.
