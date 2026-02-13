---
summary: "Authoritative v0 contracts for state machine, role boundaries, audit events, and closed dispatch tool I/O."
read_when:
  - Implementing dispatch-api mutations and validation
  - Wiring OpenClaw tools to dispatch data-plane endpoints
title: "RFC 0001 Dispatch Core Contracts v0"
---

# RFC 0001: Real Dispatch Core Contracts v0

Status: Superseded by RFC 0002
Owner: Zach
Last updated: 2026-02-13

## Purpose

This RFC is retained as the v0 baseline and historical contract record.
For active implementation, use RFC 0002 and `/src/contracts/v1.ts`.

Lock v0 contracts for Real Dispatch so implementation can proceed without drift.

This RFC defines:

- canonical dispatch state machine (authoritative transitions)
- role and permission boundaries (who can do what)
- canonical audit/event schema (append-only record)
- closed tool I/O contracts (the only mutation surface OpenClaw may use)

Non-goals:

- no frontend/UI design
- no pricing strategy policy
- no provider/channel onboarding details
- no model-memory ownership of operational state

## Principles

- Source of truth is structured case storage, not chat history.
- Model proposes actions; system validates and commits.
- Every mutation emits an audit event.
- All state-changing endpoints are idempotent.
- Agents are least-privilege by role.

## Canonical ticket lifecycle (v0)

### TicketState

- new
- triaged
- schedulable
- scheduled
- dispatched
- onsite
- closeout_pending
- closed
- canceled

### Allowed transitions

- new -> triaged
- new -> schedulable
- triaged -> schedulable
- schedulable -> scheduled
- scheduled -> dispatched
- dispatched -> onsite
- onsite -> closeout_pending
- closeout_pending -> closed

Cancellation path:

- new -> canceled
- triaged -> canceled
- schedulable -> canceled
- scheduled -> canceled

Reschedule path:

- scheduled -> scheduled (self-transition allowed when schedule details change)

Notes:

- Any transition not listed is invalid.
- State must only change via dispatch-api endpoints that enforce this matrix.

## Role boundaries (v0)

Roles:

- system_intake_agent
- system_scheduling_agent
- system_technician_liaison_agent
- system_closeout_agent
- operator_admin
- technician
- customer

Policy expectations:

- Intake role can create/triage/schedulability actions only.
- Scheduling role can schedule/dispatch/assignment actions only.
- Technician liaison role can onsite/evidence/closeout-ready actions only.
- Closeout role can evidence validation + closeout artifact generation + closure only.
- Admin can override all actions, but every override remains fully audited.

Action allowlist matrix (v0):

- `system_intake_agent`: `ticket.create`, `ticket.add_message`, `ticket.set_priority`
- `system_scheduling_agent`: `ticket.add_message`, `schedule.propose_slots`, `schedule.confirm`, `dispatch.assign_tech`, `dispatch.set_eta`
- `system_technician_liaison_agent`: `ticket.add_message`, `closeout.add_note`, `closeout.add_photo`, `closeout.checklist_complete`
- `system_closeout_agent`: `billing.generate_invoice_draft`, `billing.compile_closeout_packet`
- `operator_admin`: all closed mutation actions
- `technician`: `ticket.add_message`, `closeout.add_note`, `closeout.add_photo`
- `customer`: `ticket.add_message`

## Canonical audit event schema (v0)

Audit events are append-only and never edited.

Each state-changing endpoint MUST:

1. validate input
2. validate role + transition permissions
3. apply mutation
4. write audit event(s)
5. return updated canonical ticket snapshot

Audit events MUST include:

- immutable event_id
- ticket_id (nullable for system-only events)
- actor (role + id)
- source channel (if applicable)
- request_id (idempotency key)
- type and payload
- timestamp
- previous_state and next_state (for transitions)

## Closed tool surface (v0)

OpenClaw may only call dispatch-api via these actions.

Ticket:

- ticket.create
- ticket.add_message
- ticket.set_priority

Scheduling:

- schedule.propose_slots
- schedule.confirm

Dispatch:

- dispatch.assign_tech
- dispatch.set_eta

Closeout:

- closeout.add_note
- closeout.add_photo
- closeout.checklist_complete

Billing:

- billing.generate_invoice_draft
- billing.compile_closeout_packet

All other mutations are out of scope for v0.

## Closeout checklist minimum set (v0)

- work_performed
- parts_used_or_needed
- resolution_status
- onsite_photos_after
- billing_authorization

## Idempotency

All state-changing endpoints require:

- request_id (string)
- ticket_id (when relevant)

If the same request_id is seen again for the same endpoint and ticket scope,
the server MUST return the original response without duplicating events.

## Data integrity constraints

- ticket.state only updates through allowed transitions.
- every inbound/outbound message is stored raw + normalized and linked to ticket.
- attachments have stable storage keys and optional content hashes.
- closure is blocked unless required checklist gates are complete.

## Contract source files

- `/src/contracts/v0.ts`

## Implementation order (required)

1. Build dispatch-api skeleton + DB migrations.
2. Implement audit + idempotency middleware first.
3. Implement closed endpoint set.
4. Wire OpenClaw tool policy to call only closed endpoints.
5. Add e2e lifecycle tests: intake -> schedule -> dispatch -> onsite -> closeout -> closed.

## Open questions (deferred to v0.1)

- Should invoice collection/payment be represented as a separate billing substate object after `closed`?
- Should emergency pricing approval be normalized as a separate artifact vs boolean field?
- Should multi-site chains use one ticket per site or one parent ticket + child work orders?
