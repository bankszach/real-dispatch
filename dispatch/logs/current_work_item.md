# Current Work Item

## Story ID
`STORY-02: Append-only audit events + timeline`

## Epic
`EPIC-01: v0 Dispatch API Spine`

## Priority
`P0`

## Acceptance Criteria (from backlog)
- Every mutation creates audit event with actor/tool/before/after/correlation_id.
- Timeline endpoint returns ordered events (`GET /tickets/{id}/timeline`).

## Why This Was Selected
`STORY-01` is complete and provides command mutation flow + idempotency enforcement. The next dependency-valid P0 item is timeline/audit completeness, which is needed before closed-tool bridge integration and canonical E2E proof.

## Dependency Check
- Schema/migrations: satisfied (`STORY-03` complete).
- Command mutation path: satisfied (`STORY-01` complete).
- Audit infra before E2E harness: this story completes timeline visibility needed by acceptance gates.

## Deterministic Scope for Next Cycle
- Add timeline read endpoint: `GET /tickets/{ticketId}/timeline`.
- Validate and normalize audit payload/field completeness against ground-truth contract.
- Add tests for ordered timeline retrieval and correlation-id presence.
