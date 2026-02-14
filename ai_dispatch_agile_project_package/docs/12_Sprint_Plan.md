# Sprint Plan (Current MVP Sequence)

**Updated:** February 14, 2026

## 1) Delivery Baseline

- v0 implementation phase is complete (`STORY-01` through `STORY-10`).
- MVP parity phase is partially complete (`MVP-01`, `MVP-02` complete).
- Active critical-path item is `MVP-03` (Security Hardening).

## 2) Sprint M2 (Week of February 17, 2026)

In scope:
- `MVP-03` Production authn/authz claims integration
- `MVP-04` Signature + evidence hardening
- `MVP-05` CI blocking quality gates

Planned sequence:
1) Ship `MVP-03` first.
2) Ship `MVP-04` against the new auth model.
3) Ship `MVP-05` to lock release quality gates.

Exit criteria:
- Claims-based auth enabled with negative test coverage.
- Signature/no-signature and evidence reference checks enforced fail-closed.
- Dispatch suite + canonical E2E are blocking CI checks.

## 3) Sprint M3 (Week of March 3, 2026)

In scope:
- `MVP-06` Operability hardening (durable metrics/log sinks, alerts, runbooks)
- `MVP-07` Dispatcher + technician MVP build

Exit criteria:
- Runbooks validated in staging.
- Core UI workflows use dispatch-api command endpoints only.

## 4) Sprint M4 (Week of March 17, 2026)

In scope:
- `MVP-08` Pilot readiness and cutover

Exit criteria:
- UAT signoff complete.
- Rollback rehearsal complete.
- Release candidate freeze checklist complete.

## 5) Tracking Rules

- Active backlog source: `backlog/backlog.csv`.
- Current work item marker: `dispatch/logs/current_work_item.md`.
- Completion evidence log: `dispatch/logs/progress_log.md`.
