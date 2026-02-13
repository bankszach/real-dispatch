---
summary: "End-to-end dispatch setup policy for Real Dispatch on the OpenClaw scaffold."
read_when:
  - Setting up a dispatch-focused deployment
  - Enforcing lifecycle and role boundaries
title: "Dispatch Setup Guide"
---

# Dispatch Setup Guide

> This page keeps the legacy `/start/openclaw` path for compatibility.

## Locked architecture

- OpenClaw: control plane only.
- Real Dispatch: data plane and source-of-truth case file.

## Safety baseline

- closed dispatch toolset only
- no public skill marketplace in production
- no arbitrary shell/OS execution for production dispatch roles
- system-of-record case file required for every state transition
- full immutable audit trail for every mutation

## Canonical lifecycle

`new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`

Direct `new -> closed` or any bypass transition is invalid.

## Role boundaries

- **Intake Agent**: create/triage/schedulability only.
- **Scheduling Agent**: slot/confirm/assign/dispatch only.
- **Technician Liaison Agent**: onsite communication + evidence + closeout_pending.
- **Closeout Agent**: checklist validation + closeout artifacts + closure.

## Required case-file fields

- ticket/job id
- customer profile + contact
- service location
- issue summary + classification
- schedule history + assignment history
- technician updates timeline
- attachments (photos/documents)
- closeout checklist status
- invoice draft fields
- immutable audit trail

## Closed mutation actions (v0)

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

## Operational checks before rollout

```bash
pnpm openclaw status --all
pnpm openclaw health --json
```

Confirm:

- inbound requests normalize into structured tickets
- schedule actions produce assignment and confirmation artifacts
- onsite evidence is attached before closeout
- closure is blocked until checklist gates pass
- every state change is replayable in audit history
