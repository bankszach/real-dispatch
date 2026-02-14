# Dispatch Policy

Policy artifacts in this directory define what agents are allowed to do, under which escalation conditions, and how evidence/closeout rules are enforced.

Use this folder for:
- role permissions
- autonomy ladder
- escalation matrix
- SOP revisions
- incident/evidence template policy data

## Incident templates

- `incident_type_templates.v1.json` defines required evidence and checklist gates per incident type.
- Templates are consumed by `dispatch/workflow-engine/rules/closeout-required-evidence.mjs`.
