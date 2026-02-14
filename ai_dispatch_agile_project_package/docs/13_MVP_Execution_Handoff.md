# MVP Execution Handoff (Engineering-Ready)

**Prepared on:** February 14, 2026  
**Audience:** Technical development team (backend, security, QA, DevOps, UX)  
**Purpose:** Align Real Dispatch runtime and agile package artifacts, then hand off a single MVP implementation plan with clear ownership, dependencies, and delivery gates.

## 1) Alignment Decisions (Locked for MVP)

1. Backlog source of truth:
- Use `ai_dispatch_agile_project_package/backlog/backlog.csv` as the only active backlog.
- Keep only outstanding work in this file.
- Keep historical completion narrative in `dispatch/logs/progress_log.md`.

2. Execution priority:
- Deliver strictly in dependency order: `MVP-03` -> `MVP-04` -> `MVP-05` -> `MVP-06`/`MVP-07` -> `MVP-08`.

3. Release gates:
- MVP is not handoff-complete until auth hardening (`MVP-03`), evidence hardening (`MVP-04`), and blocking CI quality gates (`MVP-05`) are complete.

4. System boundary:
- `dispatch-api` remains the only mutation authority.
- Tool bridge remains closed and allowlisted.

## 2) Current Delivery Baseline

- v0 stories (`STORY-01` through `STORY-10`) are complete.
- `MVP-01` and `MVP-02` are complete.
- Current work item: `MVP-03` (Security Hardening).
- Latest deterministic regression run: `node --test --test-concurrency=1 dispatch/tests/*.mjs` passing (36/36).

## 3) MVP Scope by Workstream

### Workstream A: Security/Auth Hardening (`MVP-03`) [Critical Path]
- Objective: Replace header-trust identity with signed claims and scope-bound authorization.
- Primary code areas:
  - `dispatch/api/src/server.mjs`
  - `dispatch/api/src/http-utils.mjs`
  - `dispatch/tools-plugin/src/bridge.mjs`
  - `dispatch/tests/*` (new negative auth tests + updated integration flows)
- Definition of done:
  - Production mode rejects header-only actor context.
  - Signed claims drive role + account/site scope checks.
  - Forged/invalid claims fail closed.
  - Read and write endpoints both enforce authz scope.

### Workstream B: Evidence Hardening (`MVP-04`)
- Objective: Enforce signature policy and object-store evidence validation.
- Primary code areas:
  - `dispatch/api/src/server.mjs`
  - `dispatch/workflow-engine/rules/closeout-required-evidence.mjs`
  - `dispatch/policy/incident_type_templates.v1.json`
  - `dispatch/tests/story_07_evidence_api.node.test.mjs`
  - `dispatch/tests/story_08_e2e_canonical.node.test.mjs`
- Definition of done:
  - `signature_ref` OR explicit `no_signature_reason` is required for completion.
  - Evidence URIs are validated as resolvable object-store references before complete/verify.
  - Negative tests cover missing/invalid signature and invalid evidence references.

### Workstream C: Quality Gates (`MVP-05`)
- Objective: Make dispatch quality checks blocking in CI.
- Primary code areas:
  - `.github/workflows/ci.yml`
  - `package.json` scripts (if needed)
  - `dispatch/tests/*.mjs`
- Definition of done:
  - Migration + dispatch story suite + canonical E2E are blocking CI checks.
  - One-command local parity check documented and reliable.

### Workstream D: Operability (`MVP-06`)
- Objective: Operational readiness via durable observability and runbooks.
- Primary code/document areas:
  - `dispatch/ops/`
  - `ai_dispatch_agile_project_package/docs/08_Observability_and_Runbooks.md`
  - runtime metrics/log wiring files
- Definition of done:
  - Durable log/metrics sinks configured for staging/prod path.
  - Alert thresholds documented.
  - Runbooks validated for top failure modes.

### Workstream E: UX MVP Build (`MVP-07`)
- Objective: Implement dispatcher and technician surfaces from published specs.
- Primary code/doc areas:
  - `dispatch/ux/dispatcher_cockpit_v0.md`
  - `dispatch/ux/technician_job_packet_v0.md`
  - UI implementation paths in repo
- Definition of done:
  - UI calls only closed dispatch commands.
  - Fail-closed responses and role restrictions are visible to operators.

### Workstream F: Pilot Readiness (`MVP-08`)
- Objective: UAT, rollback rehearsal, and release candidate freeze.
- Primary areas:
  - ops validation scripts/checklists
  - UAT packet and signoff artifacts
- Definition of done:
  - UAT signoff complete.
  - Rollback/cutover checklist complete.

## 4) Sprint Sequence (Proposed)

## Sprint M2 (Week of February 17, 2026)
- In scope: `MVP-03`, `MVP-04`, `MVP-05`.
- Exit criteria:
  - Claims-based auth active with negative test coverage.
  - Signature/evidence hardening complete.
  - Dispatch suite and canonical E2E are CI blockers.

## Sprint M3 (Week of March 3, 2026)
- In scope: `MVP-06`, `MVP-07`.
- Exit criteria:
  - Runbooks and alerting validated in staging.
  - Dispatcher/technician MVP flows implemented against command endpoints.

## Sprint M4 (Week of March 17, 2026)
- In scope: `MVP-08`.
- Exit criteria:
  - Pilot UAT signoff.
  - Rollback rehearsal complete.
  - RC freeze checklist complete.

## 5) Engineering Handoff Checklist

- [ ] Pull latest `main` and confirm clean branch state before execution.
- [ ] Use `ai_dispatch_agile_project_package/backlog/backlog.csv` as planning source.
- [ ] Start with `MVP-03` only; do not parallelize work that depends on unshipped auth model.
- [ ] Add or update tests before marking item complete.
- [ ] Record completion evidence in `dispatch/logs/progress_log.md`.
- [ ] Update `dispatch/logs/current_work_item.md` and `dispatch/logs/next_story_recommendation.md` after each completed MVP item.

## 6) Delivery Governance

- Daily:
  - Update backlog status and blockers.
  - Report test status and regression deltas.
- Per story completion:
  - Attach validation command output summary.
  - Confirm acceptance criteria line-by-line.
- Per sprint close:
  - Review unresolved risks and carry-over decisions.

