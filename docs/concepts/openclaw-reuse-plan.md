---
summary: "Lock-in plan for keeping OpenClaw as control plane and Real Dispatch as the authoritative data plane."
read_when:
  - Planning migration from scaffold-first to dispatch-first architecture
  - Defining hard boundaries between orchestration and operational state
title: "OpenClaw Reuse Plan"
---

# OpenClaw to Real Dispatch reuse plan

This plan maps OpenClaw control-plane components (gateway, routing, scheduler, session runtime) to Real Dispatch product requirements (intake, scheduling, technician liaison, closeout, billing-ready closure).

Contract lock for this plan is documented in [RFC 0001 dispatch core contracts](/rfcs/0001-dispatch-core-contracts-v0).

## Direction lock-in

- OpenClaw remains the control plane.
- Real Dispatch owns all case-file state and business logic.
- Model output never commits operational state directly.

## What we keep from OpenClaw

### Gateway and channel ingress

- Keep multi-channel adapters and normalized inbound handling.
- Keep session/routing infrastructure.
- Keep control UI and operator RPC surfaces.

### Scheduler and automation runtime

- Keep cron, heartbeat wakeups, and isolated runs.
- Keep hook/webhook surfaces for event-driven operations.

### Agent runtime and tool streaming

- Keep session lane serialization, lifecycle streaming, and tool execution plumbing.
- Keep per-agent sandbox and tool policy controls.

## What Real Dispatch must own

### Authoritative case file

Case truth lives in dispatch data storage:

- tickets/jobs
- customer/site records
- assignment and schedule history
- technician update timeline
- closeout checklist + artifacts
- invoice draft artifact
- append-only audit timeline

### Canonical lifecycle (v0)

`new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`

### Closed dispatch toolset

Only these state-changing actions are permitted:

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

Each action must:

- validate schema
- validate role permissions
- validate state transition legality
- write immutable audit event(s)
- return canonical updated ticket snapshot

## Reference topology (minimum v0)

- `openclaw-gateway` (control plane)
- `dispatch-api` (data plane + closed tool endpoints)
- `postgres` (structured dispatch state)
- `minio` (attachments/closeout artifacts)
- optional `dispatch-worker` (timers, escalations, packet jobs)

## Boundary rules

### Boundary A: control plane -> data plane

OpenClaw may call only:

- closed dispatch mutation endpoints
- read-only case summary endpoints

### Boundary B: data plane -> external systems

Only dispatch-api/worker integrate with:

- payments
- vendor/parts systems
- mapping/geocoding
- outbound invoice systems

This prevents agent-level integration drift.

## State handling rule (per turn)

1. Load authoritative case state from dispatch storage.
2. Build compact case summary for model context.
3. Model proposes next action(s).
4. Execute action(s) through closed endpoints only.
5. Commit validated transitions with audit events.
6. Send outbound updates using committed facts only.

## Phase execution

### Phase 1: Contract and guardrails

- lock lifecycle and role matrix
- lock tool I/O contracts
- lock audit schema + idempotency requirements

### Phase 2: Data-plane skeleton

- dispatch-api scaffolding
- DB schema + migrations
- object storage bindings
- audit/idempotency middleware

### Phase 3: Tool bridge and workflows

- OpenClaw plugin exposing dispatch tools
- intake/scheduling/liaison/closeout workflow gates
- operator override + escalation paths

### Phase 4: Production hardening

- e2e lifecycle tests
- failure and replay tests
- operational metrics and autonomy ladder gates
