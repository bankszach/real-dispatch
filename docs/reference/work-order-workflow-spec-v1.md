---
summary: "Formal workflow specification for work-order lifecycle, transition guards, checkpoints, and exception paths."
read_when:
  - Implementing dispatch lifecycle transitions and validation rules
  - Building queue views, agent prompts, and operator controls
title: "Work Order Workflow Spec v1"
---

# Work Order Workflow Spec v1

## Contract baseline

Primary lifecycle is contract-locked by [RFC 0001](/rfcs/0001-dispatch-core-contracts-v0):

`new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`

This spec adds transition guards and non-breaking workflow checkpoints.

## Transition guard matrix

| Transition | Required inputs | Allowed roles | Required audit events |
| --- | --- | --- | --- |
| `new -> triaged` | customer identity or pending verification flag, location, issue summary, priority | `system_intake_agent`, `operator_admin` | `wo.created`, `wo.triaged` |
| `new -> schedulable` | same as above plus enough detail to schedule | `system_intake_agent`, `operator_admin` | `wo.created`, `wo.schedulable` |
| `triaged -> schedulable` | incident type, urgency/SLA, entitlement decision pending or resolved | `system_intake_agent`, `operator_admin` | `wo.schedulable` |
| `schedulable -> scheduled` | confirmed appointment window, customer confirmation log, access plan | `system_scheduling_agent`, `operator_admin` | `wo.scheduled` |
| `scheduled -> dispatched` | technician assignment, ETA, job packet issued | `system_scheduling_agent`, `operator_admin` | `wo.dispatched`, `wo.eta_set` |
| `dispatched -> onsite` | check-in timestamp, check-in actor, onsite contact attempt result | `system_technician_liaison_agent`, `technician`, `operator_admin` | `wo.onsite` |
| `onsite -> closeout_pending` | required checklist status, evidence set, resolution summary | `system_technician_liaison_agent`, `operator_admin` | `wo.closeout_pending` |
| `closeout_pending -> closed` | closeout packet, invoice draft, gates passed | `system_closeout_agent`, `operator_admin` | `wo.closed`, `billing.invoice_draft_generated` |

## Optional checkpoints (sub-statuses)

Sub-statuses are additive metadata and do not replace `ticket.state`.

### Intake checkpoint

- `needs_info`: minimum intake fields are missing.
- Exit condition: all required intake fields captured.

### Entitlement checkpoint

- `approval_required`: estimate exceeds NTE or policy threshold.
- Exit condition: approved or denied with explicit actor and reason.

### Execution checkpoint

- `on_hold`: blocked by parts, access, safety, or pending approval.
- `return_visit_required`: follow-up dispatch needed.
- Exit condition: blocker resolved and next appointment/disposition set.

### Verification checkpoint

- `completed_pending_verification`: field work done, awaiting QA/customer signoff.
- Exit condition: verification pass or rework decision.

### Billing checkpoint

- `invoiced`, `paid`: billing lifecycle progress after closure artifacts are complete.
- These can live on billing objects while `ticket.state` remains `closed`.

## Required fields by stage

### Intake required fields

- `account_id` or `prospect_contact`
- `site_id` or normalized service location
- `requester_contact`
- `issue_description`
- `incident_type` (or temporary `unknown`)
- `urgency`

### Scheduling required fields

- `sla_target`
- `entitlement_decision`
- `schedule_window`
- `assigned_technician_id`
- `access_instructions`

### Onsite required fields

- `check_in_at`
- `work_performed_summary`
- `parts_used_or_needed`
- required `evidence` artifacts from incident template
- `check_out_at`

### Closeout required fields

- `closeout_checklist_status`
- `resolution_code`
- `customer_signoff` or reason missing
- `invoice_draft_fields`

## Exception workflows

### Emergency dispatch

- Set `emergency_dispatch=true`.
- Can accelerate scheduling path, but cannot skip audit event writes.
- Requires explicit reason and escalation contact log.

### Safety lockout

- Set `safety_lockout=true`.
- Requires safety warning, temporary remediation note, and escalation path.
- Closure blocked until safety checklist passes.

### Return visit loop

- Set `requires_return_visit=true`.
- Create follow-up appointment or child work order.
- Preserve parent-child linkage and original incident context.

## Deterministic policy checks

Each transition validation must enforce:

- role permission check
- allowed state transition check
- required field completeness
- approval gate checks (NTE/contract)
- idempotency (`request_id`)
- immutable audit write

## Role outputs contract

Intake output:

- normalized ticket summary
- required-fields checklist
- next state recommendation

Scheduling output:

- committed schedule object
- assigned technician
- customer confirmation log

Technician liaison output:

- onsite timeline
- evidence completeness status
- closeout readiness decision

Closeout output:

- closeout packet artifact
- invoice draft artifact
- closure audit record
