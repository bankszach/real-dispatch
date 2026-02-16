# Control Plane Temporal Worker (skeleton)

This package owns the Temporal runtime bootstrap for dispatch control-plane workflows.

- `DISPATCH_TEMPORAL_MODE=temporal` starts a real Temporal worker (requires `@temporalio/worker`).
- default mode runs a skeleton heartbeat so the container can start in dev without Temporal SDK installed yet.

Environment:

- `DISPATCH_API_URL` (default: `http://dispatch-api:8080`)
- `TEMPORAL_ADDRESS` (default: `temporal:7233`)
- `TEMPORAL_NAMESPACE` (default: `default`)
- `TEMPORAL_TASK_QUEUE` (default: `dispatch-ticket-workflows`)
- `DISPATCH_TEMPORAL_HEARTBEAT_MS` (default: `5000`)
- `DISPATCH_TEMPORAL_SHUTDOWN_MS` (default: `10000`)
- `DISPATCH_TEMPORAL_WORKER_IDENTITY` (auto-generated if omitted)
