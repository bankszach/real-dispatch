# Policy Contract Notes

- Canonical roles are defined in `/dispatch/shared/authorization-policy.mjs` via `DISPATCH_CANONICAL_ROLES`.
- Role aliases are centralized in `DISPATCH_ROLE_ALIASES` (for example, `tech` and `technician` both map to `technician`).
- Unknown/invalid roles fail closed as auth policy errors with `policy_error.dimension === "role"`.

- Public tool surface is the plugin/API action surface used for user interaction.
  - In `dispatch/tools-plugin/src/index.ts`, `dispatch_contract_status.tool_names` is built from filtered `toolDefinitions`.
  - `assignment.recommend` is intentionally filtered out until recommendation readiness is production-safe.
- `dispatcher.cockpit` actions are built from the same policy surface and must also omit intentionally hidden tools.

- Expected policy error envelope:
  - include `policy_error.dimension` for every expected deterministic failure.
  - include `from_state`, `allowed_from_states`, and `to_state` for state transition failures.
  - include `dimension` and contextual fields for role/tool/evidence/scope failures as applicable.

- Invariant: expected-invalid requests must never return `INTERNAL_ERROR`; they must return one of
  `INVALID_REQUEST`, `INVALID_AUTH_CLAIMS`, `TOOL_ROLE_FORBIDDEN`, `UNKNOWN_TOOL`, or `INVALID_STATE_TRANSITION`
  with policy fields (or request validation equivalent).
