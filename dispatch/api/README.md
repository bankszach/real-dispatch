# Dispatch API Scaffold

This service will own all source-of-truth case-file mutations.

## Responsibilities

- validate input schemas
- validate role and state-transition permissions
- write immutable audit events
- enforce idempotency by `request_id`
- persist canonical ticket snapshot + related artifacts

## Out of scope

- direct model calls
- prompt memory as source of truth
- ad hoc mutations outside closed tool contracts
