# Dispatch Ops Scaffold

This folder contains local and production topology references for running:

- OpenClaw gateway (control plane)
- dispatch-api (data plane)
- postgres (state)
- object storage (attachments/artifacts)
- worker (background jobs)

Use the root scripts for local orchestration:

- `pnpm dispatch:stack:up`
- `pnpm dispatch:stack:status`
- `pnpm dispatch:stack:down`

Runbooks and drill assets:

- `dispatch/ops/runbooks/README.md`
- `dispatch/ops/runbooks/stuck_scheduling.md`
- `dispatch/ops/runbooks/completion_rejection.md`
- `dispatch/ops/runbooks/idempotency_conflict.md`
- `dispatch/ops/runbooks/auth_policy_failure.md`
- `dispatch/ops/runbooks/mvp_06_on_call_drill.md`
- `dispatch/ops/runbooks/mvp_08_pilot_cutover_readiness.md`
- `dispatch/ops/runbooks/mvp_launch_checkpoint.md` (current launch checkpoint and recovery path)

## MVP launch checkpoint: restart to known-good state

Use this sequence whenever you want to recover to the currently validated, dispatch-available state:

1. Rehydrate infra:
   - `pnpm dispatch:stack:down`
   - `pnpm dispatch:stack:up`
   - `pnpm dispatch:stack:status`
2. Restart OpenClaw gateway and confirm plugin registration:
   - `pnpm openclaw gateway restart`
   - `pnpm openclaw status --json`
3. Open chat UI:
   - `pnpm openclaw dashboard`
4. Validate chat/tool availability (in chat):
   - `dispatch_contract_status`
   - `dispatcher_cockpit` (canonical alias: `dispatcher.cockpit`)

If you want to verify end-to-end work path from chat, use:

- `ticket.create`
- `dispatcher_cockpit` (the created ticket should now be visible)
- `ticket.get <ticket_id>` (or `ticket.timeline <ticket_id>`)
- `node --test --test-concurrency=1 dispatch/tests/*.mjs`

See `dispatch/ops/runbooks/mvp_launch_checkpoint.md` for exact payload examples and expected outputs.
