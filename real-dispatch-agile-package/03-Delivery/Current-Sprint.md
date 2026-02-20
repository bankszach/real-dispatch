# Current Sprint (single source of sprint truth)

**Canonical planning source for active execution:** this file.

## Sprint 1 (2026-02-16 → 2026-03-01): Foundations

- `packages/dispatch-contracts` scaffold
- Trace propagation baseline
- Temporal dev compose + worker skeleton (no mutations)
- Read-only Temporal activities (ticket/timeline fetch)
- File handoff artifacts + Temporal spike baseline

File handoff naming pattern for active workstream:

- `E6-F1-S1__who__YYYY-MM-DD__slug.bundle`
- `E6-F1-S1__who__YYYY-MM-DD__slug.patches/`
- Example: `E6-F1-S1__zach__2026-02-16__shadow-proposal`

## Active dependencies

- File handoff plan: `real-dispatch-agile-package/03-Delivery/03-PR-Plan.md`
- Backlog: `real-dispatch-agile-package/02-Backlog/02-Stories.md`
- File handoff gates: `CONTRIBUTING.md`, `real-dispatch-agile-package/03-Delivery/00-Release-Gates.md`

## Current execution focus

1. Establish the single sprint truth surface and repoint all current-work logs.
2. Enforce file-handoff naming format with both docs + verification.
3. Complete one minimal Temporal end-to-end spike (schedule hold → release) via stub activity adapter.

Sprint-1 invariant note:

- Inbound formatting maps `[dispatch]` → `[openclaw]` for web inbound display; dispatch internals remain unchanged.

## Sprint 2 (2026-03-02 → 2026-03-15): Technician Directory replacement

- Replace hardcoded `TECHNICIAN_DIRECTORY` with persistent policy-aware technician data (`technicians`, `technician_skills`, `technician_regions`, `technician_availability`).
- Route `assignment.recommend` and `assignment.dispatch` through DB-backed technician filtering by active status, skill match, region eligibility, and active workload.
- Keep recommendation snapshots unchanged from API contract perspective while ensuring all dispatch assignment inputs come from truth, not stub fixtures.
- Preserve existing comms/autonomy boundaries for this sprint:
  - no communications rollout
  - no autonomy expansion
  - no external SaaS wiring
