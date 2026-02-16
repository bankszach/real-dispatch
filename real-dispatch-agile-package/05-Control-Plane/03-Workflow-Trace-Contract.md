# E1-F1-S1 Thin-slice workflow trace contract

## Canonical contract artifact

- Story: `E1-F1-S1`
- Purpose: deterministic control-plane orchestration envelope and events for schedule-hold thin slice.
- Contract owner: vNext control-plane team

## Envelope fields (required)

Payload must include:

- `ticket_id` (string)
- `policy_context` (object)
- `requested_window` (object with `start`, `end` strings)
- `envelope.correlation_id` (string)
- `envelope.causation_id` (string)
- `envelope.idempotency_key` (string)
- `envelope.ticket_id` (string)
- `envelope.actor` (DispatchActor)
- `envelope.timestamp` (ISO string)
- `envelope.schema_version` (must equal `v1`)
- `envelope.event_name` (enum below)

Optional:

- `envelope.traceparent`
- `envelope.tracestate`
- `envelope.step_name`

## Event names

Allowed values:

- `dispatch.thin_slice.workflow_requested`
- `dispatch.thin_slice.hold_created`
- `dispatch.thin_slice.hold_committed`
- `dispatch.thin_slice.hold_released`
- `dispatch.thin_slice.hold_rollback`
- `dispatch.thin_slice.closeout_candidate_emitted`

## Validation contract

Validator under `packages/dispatch-contracts`:

- `validateThinSliceWorkflowCommand(payload)`
- accepts exactly the shape above
- fails when required fields are missing or invalid

Contract invariants:

- missing required field => `{ ok: false }`
- invalid `traceparent` => `{ ok: false, reason }`
- invalid `schema_version` => `{ ok: false, reason }`
- event name outside allowed set => `{ ok: false, reason }`

## Thin-slice state progression (first story)

- `workflow_requested`
- `hold_created`
- `hold_committed`
- `closeout_candidate_emitted`

## Evidence / acceptance

Execution command and expected output:

- `node --test packages/dispatch-contracts/tests/contracts.test.mjs`
  - valid thin-slice payload should return ok
  - missing/invalid payload should return errors
