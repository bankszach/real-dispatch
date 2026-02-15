# Dispatch Worker Scaffold

Background jobs owned by worker:

- follow-up reminders
- schedule nudges/escalations
- stale ticket detection
- closeout packet assembly tasks
- invoice draft generation retries

Worker jobs must call dispatch-api and emit auditable outcomes.

Current demo/default operational mode:

- `dispatch-worker` starts `dispatch/worker/dispatch-worker-placeholder.mjs` in MVP container stacks.
- The worker executes a deterministic background workflow against scheduled tickets:
  - fetches dispatch cockpit queue in `SCHEDULED` state,
  - requests an assignment recommendation,
  - dispatches to the recommended technician,
  - writes per-ticket success/failure telemetry and increments in-process metrics.
- It emits heartbeat events with queue metrics and logs structured failure records.
- The worker uses idempotency keys per ticket/action and supports safe shutdown on `SIGINT`/`SIGTERM`.
- Keep this file aligned with dispatcher policy updates before enabling production workloads.
