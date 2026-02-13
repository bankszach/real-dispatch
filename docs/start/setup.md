---
summary: "Advanced setup and co-development workflow for Real Dispatch on OpenClaw."
read_when:
  - Setting up a new machine
  - Aligning development flow with dispatch-first architecture
title: "Setup"
---

# Setup

## Development model

- Keep OpenClaw runtime and upgrades in `/src` and scaffold docs.
- Build Real Dispatch product surfaces in `/dispatch`.
- Keep contracts/policies locked before enabling autonomous behaviors.

## Recommended workflow

1. Run control plane locally (`pnpm gateway:watch` during development).
2. Implement data-plane features behind closed dispatch actions.
3. Gate each release with lifecycle + audit + role-boundary tests.
4. Promote autonomy in stages only after KPI thresholds pass.

## Workspace hygiene

- Keep product decisions in RFC/ADR docs under `/docs` and `/dispatch`.
- Avoid embedding operational truth in prompt-only memory.
- Keep environment secrets in `~/.openclaw` and runtime env vars, not repo docs.

## Primary references

- [Dispatch contracts RFC](/rfcs/0001-dispatch-core-contracts-v0)
- [OpenClaw reuse plan](/concepts/openclaw-reuse-plan)
- [Dispatch setup guide](/start/openclaw)
