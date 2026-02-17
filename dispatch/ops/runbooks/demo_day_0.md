# Real Dispatch Day-0 Demo Runbook

This runbook executes the canonical dispatch lifecycle end-to-end on a local machine.

## Prerequisites

- Node.js 22.12+ available
- Docker + Docker Compose v2
- `pnpm` 10.23.0
- At least 2 GB free disk for Docker image build/cache

## 1) Prepare environment

From repository root:

```bash
cp .env.demo .env
```

Optional overrides (set before running):

- `OPENCLAW_CONFIG_DIR` and `OPENCLAW_WORKSPACE_DIR`
- `DISPATCH_API_PORT` / `OPENCLAW_GATEWAY_PORT`
- `DISPATCH_DEMO_*` actor IDs used by the smoke flow
- `DISPATCH_BOOTSTRAP_EVIDENCE_PATH`

## 2) Start, bootstrap, and run smoke script

```bash
pnpm dispatch:demo
```

- For fully automated run-and-teardown:

```bash
pnpm dispatch:demo:ci
```

When stack is up, the script prints:

- OpenClaw dashboard URL
- Dispatch API URL
- bootstrap evidence JSON path

## 3) Validation checklist (post-run)

- `GET /health` returns `{"status":"ok","service":"dispatch-api"}`
- bootstrap evidence includes deterministic account/site IDs and counts
- ticket lifecycle reaches `INVOICED`
- closeout is blocked before evidence, then passes after evidence is added
- timeline includes all expected events (`ticket.create`, `ticket.triage`, `assignment.dispatch`, `tech.check_in`, 4x `closeout.add_evidence`, `tech.complete`, `qa.verify`, `billing.generate_invoice`)
- `/ux/dispatcher/cockpit` includes the demo ticket
- `/ux/technician/job-packet/{ticketId}` returns a `closeout_gate.ready === true` payload
- stack tears down cleanly after `pnpm dispatch:demo:ci` completes

## 4) Recovery commands

- Keep stack for manual inspection:

```bash
DISPATCH_DEMO_KEEP_STACK=1 pnpm dispatch:demo
```

- Watch logs:

```bash
pnpm dispatch:stack:logs
```

- Teardown:

```bash
pnpm dispatch:stack:down
```
