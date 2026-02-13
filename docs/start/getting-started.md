---
summary: "Get a local Real Dispatch environment running with locked control-plane/data-plane boundaries."
read_when:
  - First-time setup
  - Validating baseline architecture before feature work
title: "Getting Started"
---

# Getting Started

Goal: run local OpenClaw control-plane runtime and prepare the repository for dispatch-first implementation.

## Prereqs

- Node 22+
- pnpm
- Docker (recommended for local stack orchestration)

## Quick setup

<Steps>
  <Step title="Create local env file">
    ```bash
    cp .env.example .env
    ```
  </Step>
  <Step title="Install dependencies">
    ```bash
    pnpm install
    ```
  </Step>
  <Step title="Build">
    ```bash
    pnpm build
    ```
  </Step>
  <Step title="Run control plane">
    ```bash
    pnpm openclaw gateway --port 18789 --verbose
    ```
  </Step>
  <Step title="Open control UI">
    ```bash
    pnpm openclaw dashboard
    ```
  </Step>
</Steps>

## Full dispatch topology (optional, recommended for product work)

```bash
pnpm dispatch:stack:up
pnpm dispatch:stack:status
```

## Validate lock-in before building features

- lifecycle model matches `new -> ... -> closed`
- role boundaries match `/AGENTS.md`
- only closed dispatch tools are planned for state mutations
- every state mutation path is designed to emit audit events

## Next steps

- [Dispatch setup guide](/start/openclaw)
- [Dispatch contracts RFC](/rfcs/0001-dispatch-core-contracts-v0)
- [OpenClaw reuse plan](/concepts/openclaw-reuse-plan)
