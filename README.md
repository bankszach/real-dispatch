# Real Dispatch

**AI-first dispatch and closeout system for field service.**

Real Dispatch uses OpenClaw as a control plane and keeps all operational truth in a dedicated dispatch data plane.

## Product direction (locked)

- OpenClaw is the control plane: channels, sessions, routing, scheduler, runtime.
- Real Dispatch is the data plane: case files, transitions, audit trail, closeout artifacts, invoice drafts.
- State changes happen only through a closed dispatch toolset backed by dispatch-api.

## Canonical lifecycle

`new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`

## Agent roles

- Intake Agent
- Scheduling Agent
- Technician Liaison Agent
- Closeout Agent

Role policies and transition boundaries are defined in `/AGENTS.md`.

## Closed toolset (v0)

- `ticket.create`
- `ticket.add_message`
- `ticket.set_priority`
- `schedule.propose_slots`
- `schedule.confirm`
- `dispatch.assign_tech`
- `dispatch.set_eta`
- `closeout.add_note`
- `closeout.add_photo`
- `closeout.checklist_complete`
- `billing.generate_invoice_draft`
- `billing.compile_closeout_packet`

## Architecture

### Control plane (OpenClaw scaffold)

- channel adapters and inbox routing
- session orchestration and agent runtime
- scheduler/cron wakeups
- operator-facing control surfaces

### Data plane (Real Dispatch)

- tickets/jobs and case-file schema
- schedule and assignment history
- technician timeline + attachments
- closeout checklist + packet generation
- invoice draft generation
- immutable audit stream

## Repository structure (dispatch-first)

- `/dispatch` product scaffold for the data plane and workflow logic
- `/src` OpenClaw scaffold runtime and integration points
- `/docs` product, architecture, and operational references
- `/AGENTS.md` production role policies

## Key docs

- [Dispatch contract RFC](docs/rfcs/0001-dispatch-core-contracts-v0.md)
- [OpenClaw reuse plan](docs/concepts/openclaw-reuse-plan.md)
- [Dispatch setup guide](docs/start/openclaw.md)

## Development quickstart

Runtime baseline: **Node 22+**.

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm check
pnpm test
```

Dispatch topology helpers:

```bash
pnpm dispatch:stack:up
pnpm dispatch:stack:status
pnpm dispatch:stack:down
```

## Status

This repository is intentionally in active scaffold-to-product migration.
OpenClaw remains the base; Real Dispatch product boundaries are now locked around the lifecycle, role policy, and closed-tool contract.

## License

MIT (inherits upstream licensing unless otherwise noted).
