# Control Plane Temporal Worker (skeleton)

This package owns the Temporal runtime bootstrap for dispatch control-plane workflows.

- `DISPATCH_TEMPORAL_MODE=temporal` starts a workflow worker with full activity set (read-only read path only in this repository state).
- `DISPATCH_TEMPORAL_MODE=shadow` starts a workflow worker in proposal mode: hold/release intents are computed and returned as `can_apply: false` with no side effects.
- default mode runs a skeleton heartbeat so the container can start in dev without Temporal SDK installed yet.
- `action` selector inside shadow workflow input defaults to `SCHEDULE_HOLD_RELEASE_SHADOW`; unknown actions fail with `unsupported shadow workflow action`.

Environment:

- `DISPATCH_API_URL` (default: `http://dispatch-api:8080`)
- `TEMPORAL_ADDRESS` (default: `temporal:7233`)
- `TEMPORAL_NAMESPACE` (default: `default`)
- `TEMPORAL_TASK_QUEUE` (default: `dispatch-ticket-workflows`)
- `DISPATCH_TEMPORAL_HEARTBEAT_MS` (default: `5000`)
- `DISPATCH_TEMPORAL_SHUTDOWN_MS` (default: `10000`)
- `DISPATCH_TEMPORAL_WORKER_IDENTITY` (auto-generated if omitted)

Shadow demo:

- `node ./src/shadow-workflow-demo.mjs`

Shadow workflow hooks:

- Supported hook action: `SCHEDULE_HOLD_RELEASE_SHADOW`
- Output invariants: `mode: "shadow"`, `shadow_intent: "propose_only"`, `can_apply: false`
