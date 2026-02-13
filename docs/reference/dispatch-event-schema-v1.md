---
summary: "Canonical event taxonomy and payload requirements for dispatch workflow observability and auditability."
read_when:
  - Designing event-driven integrations and analytics
  - Implementing audit logs and workflow notifications
title: "Dispatch Event Schema v1"
---

# Dispatch Event Schema v1

## Purpose

Define event envelope and event names for work-order lifecycle, approvals, field execution, and closeout automation.

These events complement immutable audit records and can be emitted to queue, webhook, analytics, or notification sinks.

## Event envelope

```json
{
  "event_id": "evt_01J...",
  "event_type": "wo.dispatched",
  "occurred_at": "2026-02-13T10:18:21.000Z",
  "request_id": "req_01J...",
  "ticket_id": "wo_01J...",
  "account_id": "acct_01J...",
  "site_id": "site_01J...",
  "actor": {
    "role": "system_scheduling_agent",
    "id": "agent_sched_v1"
  },
  "previous_state": "scheduled",
  "next_state": "dispatched",
  "payload": {},
  "metadata": {
    "channel": "sms",
    "correlation_id": "corr_01J...",
    "schema_version": "v1"
  }
}
```

Required envelope fields:

- `event_id`
- `event_type`
- `occurred_at`
- `request_id`
- `ticket_id` (nullable for system events)
- `actor`
- `payload`
- `metadata.schema_version`

## Lifecycle event taxonomy

### Intake and triage

- `wo.created`
- `wo.info_requested`
- `wo.info_received`
- `wo.triaged`
- `wo.schedulable`

### Entitlement and approvals

- `wo.entitlement_evaluated`
- `approval.requested`
- `approval.approved`
- `approval.denied`
- `nte.set`
- `change_request.submitted`
- `change_request.approved`
- `change_request.denied`

### Scheduling and dispatch

- `schedule.slot_proposed`
- `schedule.confirmed`
- `schedule.rescheduled`
- `dispatch.assigned`
- `dispatch.eta_updated`
- `wo.dispatched`

### Field execution

- `wo.onsite`
- `wo.on_hold`
- `wo.resumed`
- `evidence.added`
- `checklist.updated`
- `wo.return_visit_required`
- `wo.closeout_pending`

### Verification and billing

- `closeout.validation_passed`
- `closeout.validation_failed`
- `qa.sampled`
- `qa.result_recorded`
- `billing.invoice_draft_generated`
- `billing.invoice_issued`
- `wo.closed`
- `billing.payment_recorded`

## Event payload contracts

### `wo.triaged`

```json
{
  "incident_type": "door_wont_latch",
  "priority": "high",
  "risk_flags": ["security", "egress"],
  "sla_target_at": "2026-02-13T14:00:00.000Z"
}
```

### `approval.requested`

```json
{
  "approval_type": "nte_increase",
  "requested_amount": 950.0,
  "currency": "USD",
  "threshold_rule": "site_nte_500",
  "summary": "Closer replacement required; original scope exceeded.",
  "requested_from": ["site_manager", "regional_fm"]
}
```

### `dispatch.assigned`

```json
{
  "technician_id": "tech_01J...",
  "reasoning": {
    "skill_match": true,
    "distance_km": 8.2,
    "availability_score": 0.93,
    "coverage_match": "primary"
  },
  "eta_at": "2026-02-13T12:10:00.000Z"
}
```

### `closeout.validation_failed`

```json
{
  "missing_fields": ["after_photos", "customer_signoff"],
  "anomalies": ["high_labor_hours"],
  "action_required": "return_to_technician_liaison"
}
```

## Idempotency and ordering

- Producer must emit one event set per successful mutation request.
- Duplicate `request_id` for same mutation scope must not emit new state-changing events.
- Consumer processing should use `event_id` and `occurred_at` for ordering and dedupe.

## Retention and traceability

- Keep event stream and immutable audit trail linked by `ticket_id` and `request_id`.
- Preserve event payload snapshots; do not mutate historical payloads.
- Include actor role/id for every state-changing event.
