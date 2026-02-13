---
summary: "Operating model v1 for Real Dispatch: workflow layers, case primitives, controls, SOP structure, and phased implementation."
read_when:
  - Aligning product, design, and engineering on execution model
  - Translating dispatch strategy into implementable workflows and controls
title: "RFC 0002 Dispatch Operating Model v1"
---

# RFC 0002: Real Dispatch Operating Model v1

Status: Draft
Owner: Product + Dispatch Engineering
Last updated: 2026-02-13

## Purpose

Define the build-ready operating model for Real Dispatch across intake, scheduling, field execution, verification, and billing readiness.

This RFC is the execution companion to [RFC 0001](/rfcs/0001-dispatch-core-contracts-v0).

## Relationship to RFC 0001

- RFC 0001 remains authoritative for canonical `ticket.state`, closed mutation actions, and role boundaries.
- RFC 0002 adds workflow checkpoints, data model primitives, SOP templates, and operations controls.
- On conflict, RFC 0001 wins until contracts are revised.

## Operating model layers

### Layer A: Command center

Control tower for triage, scheduling, communications, escalations, and SLA risk monitoring.

System behavior:

- AI acts as first-line dispatcher for intake, triage, and schedule proposals.
- Human operator handles policy exceptions and overrides.

### Layer B: Provider execution

Standardized technician workflow for dispatch packet handling, onsite actions, evidence capture, and structured closeout preparation.

System behavior:

- Technician app enforces check-in/out and required checklist/evidence gates.
- Scope changes trigger NTE change control before commit.

### Layer C: Controls and governance

Compliance, QA, and financial controls that make operations scalable.

System behavior:

- Deterministic entitlement and approval routing.
- Immutable audit trail for all mutations.
- QA sampling and anomaly detection on closeout packages.

## Minimum case-file primitives

Customer and site:

- `account`
- `site`
- `authorized_contacts`
- `service_terms` (SLA tier, coverage, pricing profile, warranty rules)

Assets:

- `asset` (door/operator/lock/closer/storefront, model/serial when known)
- `asset_compliance_profile`
- `asset_service_history`

Work execution:

- `work_order`
- `incident_type`
- `task_checklist`
- `appointment`
- `dispatch_assignment`
- `quote`
- `approval`
- `nte`
- `change_request`
- `evidence`
- `invoice_draft`
- `qa_result`

Provider network readiness:

- `provider`
- `coverage_map`
- `provider_skill`
- `provider_compliance_artifact`
- `provider_scorecard`

## Workflow model

Canonical state transitions remain in RFC 0001:

`new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`

Operational checkpoints are tracked as sub-status objects to avoid breaking v0 contracts:

- intake: `new | needs_info | triaged`
- entitlement: `unknown | covered | billable | approval_required | approved | denied`
- scheduling: `ready_to_schedule | proposed | scheduled | dispatched`
- execution: `onsite | on_hold | return_visit_required | completed_pending_verification`
- verification: `pending | verified | rejected`
- billing: `not_ready | draft_ready | invoiced | paid`

Required exception flags:

- `emergency_dispatch`
- `safety_lockout`
- `requires_return_visit`

## AI agent responsibilities by stage

Intake agent:

- Normalize inbound request into structured work order.
- Classify issue type, urgency, and risk flags.
- Gather required fields and route to `triaged` or `schedulable`.

Scheduling agent:

- Apply entitlement and approval rules.
- Propose slots and assign technician based on skill, coverage, availability, and access window.
- Transition `schedulable -> scheduled -> dispatched`.

Technician liaison agent:

- Capture acknowledgement and onsite timeline.
- Enforce required evidence/checklist capture.
- Manage on-hold and return-visit loops.

Closeout agent:

- Validate evidence completeness and anomalies.
- Generate closeout packet and invoice draft.
- Transition `closeout_pending -> closed` only when all gates pass.

## Controls to ship early

- NTE enforced on every work order (`0` allowed for quote-required).
- Deterministic change-request flow with threshold-based approval routing.
- Assignment fallback model (`primary -> secondary -> tertiary`).
- Tech/provider scorecards (SLA response, first-time-fix, callback rate, evidence completeness, customer rating).
- Compliance artifact structure even before subcontractor rollout.

## Required product surfaces

- Customer request and status interface.
- Dispatcher operations cockpit with SLA countdown and assignment reasoning.
- Technician mobile workflow with checklist and evidence capture.
- Approval and finance views for closeout/invoice workflows.

## Metrics contract

Operational:

- `time_to_triage`
- `time_to_schedule`
- `response_vs_sla`
- `onsite_duration`
- `first_time_fix_rate`
- `repeat_incident_rate`

Financial:

- `cost_per_work_order`
- `approval_rate`
- `invoice_cycle_time`

Quality:

- `evidence_completeness_rate`
- `qa_pass_rate`
- `customer_rating`

## Phased implementation

Phase 1 (internal tech team):

- Incident templates, checklists, intake-to-closeout flow, NTE + approvals.

Phase 2 (trusted subcontractors):

- Provider model, compliance docs, fallback assignment, provider scorecards.

Phase 3 (network scale):

- Provider portal, stronger field controls, QA audits, multi-site enterprise reporting.

## Acceptance criteria for this RFC

- Workflow, event, and SOP specs are linked and implementation-ready.
- Each role has explicit mutation boundaries and required outputs.
- Every state-changing action is auditable and idempotent.

## Contract source files

- `/src/contracts/v1.ts`
