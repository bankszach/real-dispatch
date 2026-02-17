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
- `pnpm dispatch:bootstrap`
- `pnpm dispatch:stack:down`

Demo commands:

- `pnpm dispatch:demo` starts stack, bootstraps, and runs the canonical smoke script.
- `pnpm dispatch:demo:ci` runs the same path and tears down automatically.
- `pnpm dispatch:demo:stack` runs stack+bootstrap only (no smoke assertions).

Runbook:

- `dispatch/ops/runbooks/demo_day_0.md`

For demo onboarding, use this sequence:

- `pnpm dispatch:stack:up`
- `pnpm dispatch:bootstrap`

Runbooks and drill assets:

- `dispatch/ops/runbooks/README.md`
- `dispatch/ops/runbooks/stuck_scheduling.md`
- `dispatch/ops/runbooks/completion_rejection.md`
- `dispatch/ops/runbooks/idempotency_conflict.md`
- `dispatch/ops/runbooks/auth_policy_failure.md`
- `dispatch/ops/runbooks/mvp_06_on_call_drill.md`
- `dispatch/ops/runbooks/mvp_08_pilot_cutover_readiness.md`
- `dispatch/ops/runbooks/mvp_launch_checkpoint.md` (current launch checkpoint and recovery path)
- `dispatch/ops/runbooks/v0_launch_gate_evidence_packet.md` (launch gate evidence packet for V0 pilot readiness)

## MVP launch checkpoint: restart to known-good state

Use this sequence whenever you want to recover to the currently validated, dispatch-available state:

1. Rehydrate infra:
   - `pnpm dispatch:stack:down`
   - `pnpm dispatch:stack:up`
   - `pnpm dispatch:stack:status`
   - `pnpm dispatch:bootstrap` (or `pnpm dispatch:demo:stack` for bootstrap in one step)
2. Restart OpenClaw gateway and confirm plugin registration:
   - `pnpm openclaw gateway restart`
   - `pnpm openclaw status --json`
3. Open chat UI:
   - `pnpm openclaw dashboard`
4. Validate chat/tool availability (in chat):

- `dispatch_contract_status`
- `dispatcher_cockpit` (canonical alias: `dispatcher.cockpit`)

## Using it from the OpenClaw UI chat interface

The chat tool names are exposed as:

- `dispatch_contract_status`
- `dispatcher_cockpit` (canonical OpenClaw tool name; alias is `dispatcher.cockpit`)
- `tech_job_packet` (canonical OpenClaw tool name; alias is `tech.job_packet`)
- `ticket_create`, `ticket_triage`, `schedule_propose`, `schedule_confirm`
- `assignment_dispatch`, `tech_check_in`, `closeout_add_evidence`, `tech_complete`
- `qa_verify`, `billing_generate_invoice`
- `ticket_get`, `ticket_timeline`, `closeout_list_evidence`

From the Chat UI:

- Open with `pnpm openclaw dashboard`
- Confirm plugin availability:
  - `dispatch_contract_status`
- Start the dispatcher flow:
  - `ticket_create` with `actor_role: dispatcher` and a payload including `account_id` + `site_id`
  - `ticket_triage` with `priority` + `incident_type`
  - `schedule_propose` then `schedule_confirm`
  - `assignment_dispatch` with `tech_id`
  - `dispatcher_cockpit` to confirm queue visibility
  - `tech_check_in` with `location`
  - `closeout_add_evidence` until required keys exist
  - `tech_complete` -> `qa_verify` -> `billing_generate_invoice`
  - `ticket_timeline` / `closeout_list_evidence` to inspect outcomes

Note:

- In this repo, UI tool discovery and invocation are underscore style (`ticket_create`), while API docs use dot style (`ticket.create`).
- Keep a valid actor role on each command (`dispatcher`, `tech`, `qa`, `finance`) and stable ids (`request_id` for retries).
- If `dispatch_contract_status` is not visible, restart gateway with:
  - `pnpm openclaw gateway restart`

If you want to verify end-to-end work path from chat, use:

- `ticket.create`
- `dispatcher_cockpit` (the created ticket should now be visible)
- `ticket.get <ticket_id>` (or `ticket.timeline <ticket_id>`)
- `node --test --test-concurrency=1 dispatch/tests/*.mjs`
- `pnpm dispatch:stack:down`

Bootstrap evidence:

- `pnpm dispatch:demo:stack` writes deterministic fixture IDs and restart state to stdout.
- For permanent artifact capture, set:
  - `DISPATCH_BOOTSTRAP_EVIDENCE_PATH=./dispatch/reports/bootstrap-evidence.json`
  - Then run `pnpm dispatch:bootstrap` and collect the generated JSON payload.

Worker note:

- `dispatch-worker` now runs `dispatch/worker/dispatch-worker-placeholder.mjs` as a real background workflow process.
- The worker executes scheduled-ticket assignment automation, writes structured heartbeat + failure logs, and supports safe shutdown on signal.

See `dispatch/ops/runbooks/mvp_launch_checkpoint.md` for exact payload examples and expected outputs.
