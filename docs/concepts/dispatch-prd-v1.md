---
summary: "PRD v1 for AI-first dispatch orchestration: goals, user stories, requirements, and acceptance criteria."
read_when:
  - Planning sprint work across product, design, and engineering
  - Converting dispatch operating model into implementation tickets
title: "Dispatch PRD v1"
---

# Dispatch PRD v1

## Problem statement

Service requests arrive unstructured, require fast triage, and must move through scheduling, field execution, and billing-ready closeout without compliance or documentation gaps.

## Product goal

Deliver an AI-first dispatch workflow that turns inbound requests into controlled, auditable work-order lifecycles with strong SLA, evidence, and approval guardrails.

## Non-goals (v1)

- full public subcontractor marketplace
- autonomous billing finalization without finance controls
- replacement of canonical case-file storage with chat memory

## Primary users

- dispatcher/operator
- technician
- customer contact
- closeout/finance reviewer

## User stories and acceptance criteria

### Intake and triage

1. As a dispatcher, I need inbound messages normalized into a structured work order.
   - Acceptance: system captures location, requester contact, issue summary, urgency, and incident type (or `unknown`) before triage completion.
2. As an operator, I need emergency/safety issues flagged immediately.
   - Acceptance: risk cues trigger high-priority routing and explicit warning banner.

### Entitlement and approvals

1. As a scheduler, I need deterministic coverage/NTE checks before committing work.
   - Acceptance: entitlement decision is stored and approval requests are auto-routed by threshold policy.
2. As an approver, I need plain-language context.
   - Acceptance: approval request includes issue, risk, cost impact, and requested action.

### Scheduling and dispatch

1. As a dispatcher, I need assignment recommendations with explainability.
   - Acceptance: recommendation shows skill, distance, availability, and coverage-tier rationale.
2. As a customer, I need confirmed appointment details.
   - Acceptance: schedule confirmation log is written and visible in ticket timeline.

### Field execution

1. As a technician, I need a structured job packet and checklist.
   - Acceptance: app requires check-in/out and incident-type evidence before closeout handoff.
2. As an operator, I need controlled scope changes.
   - Acceptance: NTE overages create change requests with approval outcome before extra billable work is closed.

### Closeout and billing readiness

1. As closeout, I need evidence completeness validation.
   - Acceptance: closure blocked when required artifacts are missing.
2. As finance, I need draft invoice artifacts from structured data.
   - Acceptance: invoice draft includes labor, parts, pricing profile, and approval references.

## Functional requirements

- canonical state machine enforcement from RFC 0001
- optional workflow checkpoints (needs-info, approval-required, on-hold, pending-verification)
- incident type template engine for intake/checklist/evidence rules
- immutable audit events for every mutation
- role-based mutation boundaries for intake/scheduling/liaison/closeout
- customer/dispatcher/technician/finance interfaces with consistent timeline state

## Non-functional requirements

- idempotent mutation endpoints via `request_id`
- deterministic policy enforcement before writes
- auditable history for approvals, assignment, and evidence
- reporting-ready timestamps/tags for SLA and quality metrics

## Design requirements (UI)

- dispatcher cockpit: priority queue, SLA countdown, assignment reasoning, exception alerts
- technician workflow: packet, checklist, evidence capture, change request flow
- customer status updates: scheduled/dispatched/onsite/completed states
- approval and closeout inboxes for finance and admins

## Metrics of success

- lower time-to-triage and time-to-schedule
- improved first-time-fix rate
- increased evidence completeness and QA pass rate
- reduced invoice cycle time

## Release slicing

1. Phase 1: internal team end-to-end workflow with incident templates and approvals.
2. Phase 2: controlled subcontractor support with compliance/scorecards.
3. Phase 3: network-scale controls, QA audits, and enterprise reporting.
