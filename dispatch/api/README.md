# Dispatch API

`dispatch-api` is the enforcement service for all dispatch mutations.

## Runtime entrypoint

- `dispatch/api/src/server.mjs`

Start locally:

```bash
node dispatch/api/src/server.mjs
```

## Implemented STORY-01 command endpoints

- `POST /tickets`
- `POST /tickets/{ticketId}/triage`
- `POST /tickets/{ticketId}/schedule/confirm`
- `POST /tickets/{ticketId}/assignment/dispatch`

Each command endpoint currently requires deterministic dev headers:

- `Idempotency-Key` (UUID, required)
- `X-Actor-Id` (required)
- `X-Actor-Role` (required)
- `X-Tool-Name` (optional; default is endpoint tool mapping)

## Guarantees

- fail-closed request validation
- idempotency replay (`actor_id + endpoint + request_id`)
- payload mismatch conflict (`409`)
- ticket mutation + audit event + state transition row on success

## Out of scope for STORY-01

- production authn/authz claims middleware
- timeline read endpoint (`GET /tickets/{id}/timeline`)
- full incident evidence policy enforcement
