---
summary: "SOP library skeleton for intake, dispatch, field execution, and closeout across incident types."
read_when:
  - Creating incident playbooks and technician checklists
  - Defining repeatable operational procedures for dispatch teams
title: "Dispatch SOP Library v1"
---

# Dispatch SOP Library v1

## Purpose

Provide a standardized SOP template system so incident handling is executable, auditable, and consistent.

## Incident types (initial set)

- emergency door will not secure (break-in risk)
- door will not open (business interruption)
- door will not latch / alignment issue
- closer leaking / slamming
- automatic door sensor or operator fault
- glass break / board-up coordination
- access control strike / maglock issue

## SOP template (for every incident type)

Each SOP definition should include:

- `incident_type_id`
- `category` and `subcategory`
- `default_priority` and `sla_target`
- `required_intake_fields`
- `required_intake_questions`
- `required_evidence_before`
- `required_evidence_after`
- `safety_warnings`
- `default_checklist_steps`
- `default_nte_guidance`
- `approval_rules`
- `closeout_requirements`
- `customer_update_templates`

## Intake SOP skeleton

Required sections:

- trigger criteria
- minimum questions
- emergency criteria
- required media requests
- script for customer safety and expectation setting
- output object and next state recommendation

Example minimum intake question set:

- exact site/location and entrance identifier
- on-site contact and callback number
- current symptom and first observed time
- security/safety impact now
- access window and access constraints

## Dispatch SOP skeleton

Required sections:

- assignment rules (`skill`, `distance`, `availability`, `coverage tier`)
- after-hours routing policy
- no-access/on-site contact failure path
- parts-dependent return-visit path
- escalation ladder and timeout thresholds

## Field SOP skeleton

Required sections:

- check-in and check-out procedure
- incident-specific safety assessment
- functional test steps by asset type
- evidence capture requirements (before/after, serial plate, parts)
- NTE change request procedure
- customer signoff capture

## Closeout SOP skeleton

Required sections:

- completion package validation rules
- QA sample-selection logic
- invoice draft rules by pricing model
- callback classification for repeat issues
- root-cause tagging taxonomy

## Job template object (non-negotiable)

Use a reusable job template object to power agent behavior:

```yaml
incident_type_id: automatic_door_operator_fault
category: door
subcategory: automatic_operator
default_priority: high
sla:
  response_minutes: 120
required_intake_fields:
  - site_id
  - requester_contact
  - symptom_summary
required_evidence_after:
  - before_photo
  - after_photo
  - safety_sensor_test_result
checklist:
  - perform_lockout_tagout_if_required
  - inspect_operator_fault_codes
  - verify_sensor_alignment
  - run_open_close_cycle_test
approval_rules:
  nte_default_usd: 500
  replacement_requires_approval: true
pricing_hint: time_and_material
```

## Governance hooks

Every SOP execution must produce:

- structured checklist completion data
- evidence metadata and storage links
- approval audit records where triggered
- final readiness status (`ready_for_closeout` true/false)

## Rollout recommendation

1. Implement two high-volume incident SOPs first.
2. Validate first-time-fix impact and evidence completeness.
3. Expand to full incident library once templates are stable.
