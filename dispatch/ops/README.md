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
