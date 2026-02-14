# MVP Launch Checkpoint (2026-02-14)

This document preserves the recovery path to reach the validated state where:

- OpenClaw can call dispatch tools from chat
- Dispatcher cockpit responds from the control plane
- Full dispatch test suite passes when executed from repository root

## 1) Environment and stack startup

```bash
cp .env.example .env
pnpm install   # when dependency drift is expected
pnpm dispatch:stack:down   # optional hard reset
pnpm dispatch:stack:up
pnpm dispatch:stack:status
```

If services are already up, use `pnpm dispatch:stack:up` directly after confirming status.

## 2) OpenClaw gateway/profile refresh

```bash
pnpm openclaw gateway restart
pnpm openclaw status --json
```

Expected baseline:

- OpenClaw identifies default agent profile as dispatcher.
- Dispatch plugin tools appear in the tool list.

## 3) Openchat UI

```bash
pnpm openclaw dashboard
```

Open the printed URL (or default `127.0.0.1:18789`) and verify the dispatcher profile is active.

## 4) Baseline chat smoke checks

Run these exact commands in the chat window, in order:

1. `dispatch_contract_status`
2. `dispatcher_cockpit`  
   (canonical API alias is `dispatcher.cockpit`; both are expected to route in current checkpoint)

Expected response:

- `dispatcher_cockpit` returns HTTP 200 with an empty queue when no test tickets exist yet.

## 5) Exercise one lifecycle path from chat

Use valid fixture IDs from your current DB for `account_id` and `site_id`.

```text
ticket.create
{
  "actor_id": "webchat_user",
  "payload": {
    "account_id": "d3f77db0-5d1a-4f9c-b0ea-111111111111",
    "site_id": "7f6a2b2c-8f1e-4f2b-b3a1-222222222222",
    "summary": "MVP checkpoint smoke test"
  }
}
```

Then run:

- `dispatcher_cockpit` (the created ticket should be visible in queue)
- `ticket.get <ticket_id>` (if returned id is `<ticket_id>`)
- `ticket.timeline <ticket_id>`

Expected response shape:

- Ticket create returns a valid `ticket_id`.
- Ticket read/timeline return deterministic dispatch states and timeline events.

## 6) Hard readiness gate

From repository root:

```bash
node --test --test-concurrency=1 dispatch/tests/*.mjs
```

Record summary output and include in evidence packet.

## Notes (known state)

- The checkpoint reflects an empty cockpit baseline after restart.
- No production auth integration changes are included in this snapshot; this path assumes standard local dispatch runtime configuration for test.
