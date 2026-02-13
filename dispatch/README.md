# Dispatch Product Surface

This directory is the Real Dispatch product scaffold.

## Ownership boundary

- OpenClaw scaffold owns control-plane runtime in `/src`.
- Real Dispatch product logic belongs under `/dispatch`.

## Canonical lifecycle

`new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`

## Closed dispatch action surface

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

## Directory map

- `contracts/` canonical lifecycle, schema, and event contracts
- `api/` dispatch-api service scaffold (source-of-truth case mutations)
- `tools-plugin/` OpenClaw plugin bridge exposing only closed dispatch actions
- `workflow-engine/` role and rules orchestration for intake/scheduling/liaison/closeout
- `worker/` timers, follow-ups, retries, packet/invoice jobs
- `policy/` autonomy ladder, role permissions, SOP lock-ins
- `analytics/` KPIs and autonomy promotion gates
- `e2e/` end-to-end lifecycle tests
- `ops/` deployment and local topology definitions
