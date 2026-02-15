# Backlog Status

Canonical backlog source:

- `ai_dispatch_agile_project_package/backlog/backlog.csv`

Backlog hygiene rules:

- Keep active backlog items only in the canonical CSV above.
- Do not duplicate backlog rows in this log.
- Completed story history remains in `dispatch/logs/progress_log.md`.

Current active item:

- `GLZ-09` (blind closeout candidate heuristics + manual escalation path).
- Last completed work: `GLZ-11` (alerts, dashboard telemetry, and control-path readiness).

Current planning cadence:

- Active sprint focus: `Sprint V0-3` (blocking pass into `V0-4`).
- Active epic families: `EPIC-GZ-03`, `EPIC-GZ-04`, and `EPIC-V0-COMPLETE`.

Engineering handoff readiness:

- Handoff contract now lives in:
  - `ai_dispatch_agile_project_package/docs/12_Sprint_Plan.md`
  - `ai_dispatch_agile_project_package/docs/13_V0_Engineering_Readiness_Bundle.md`
- Blocker priority now is:
  - `GLZ-09` must pass before downstream `GLZ-10` and closeout billing chain can be considered production-ready.
  - `GLZ-12` requires operator/override evidence controls and rollback proof before `V0-LAUNCH-GATE`.
