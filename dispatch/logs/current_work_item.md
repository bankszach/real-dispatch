# Current Work Item

## Story ID
`STORY-07: Evidence API + object-store reference integration`

## Epic
`EPIC-04: Evidence + Incident Templates`

## Priority
`P0`

## Acceptance Criteria (from backlog)
- Evidence references are stored and retrievable for ticket closeout artifacts.
- Evidence APIs/object-store reference workflow is integrated for completion paths.
- Closeout enforcement can consume persisted evidence references against template requirements.

## Why This Was Selected
`STORY-06` is now complete and provides deterministic incident template policy modeling. The next dependency-valid P0 item is evidence API/object-store integration so required evidence gates can be enforced against persisted evidence in real completion flows.

## Dependency Check
- Schema/migrations: satisfied (`STORY-03` complete).
- Command path + idempotency: satisfied (`STORY-01` complete).
- Timeline/audit completeness: satisfied (`STORY-02` complete).
- Closed bridge mapping: satisfied (`STORY-04` complete).
- Server-side role/tool/state auth hardening: satisfied (`STORY-05` complete).
- Incident template model: satisfied (`STORY-06` complete).
- Evidence persistence/integration before canonical E2E violation tests: pending in this story.

## Deterministic Scope for Next Cycle
- Implement evidence ingest/list/read surfaces tied to `evidence_items` references.
- Define deterministic evidence key mapping from persisted items to template-required keys.
- Wire closeout gating checks to persisted evidence references.
- Add node-native integration tests for missing-evidence fail-closed behavior on completion paths.
