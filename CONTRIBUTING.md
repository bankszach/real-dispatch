# Contributing to Real Dispatch

Real Dispatch is an AI-first dispatch and closeout product for field service, built on the OpenClaw scaffold.
Contributions should strengthen dispatch reliability, traceability, and closeout quality.

## Project scope

- **Product:** Real Dispatch (dispatch data plane, job lifecycle, closeout outputs)
- **Scaffold:** OpenClaw runtime/control plane (channels, sessions, routing, scheduler)

Treat OpenClaw as infrastructure. Product behavior and source-of-truth state belong to Real Dispatch.

## Repository links

- **GitHub:** [https://github.com/bankszach/real-dispatch](https://github.com/bankszach/real-dispatch)
- **Upstream scaffold:** [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)

## What to work on first

- intake normalization and schedulability checks
- scheduling/assignment correctness
- technician update and evidence capture flow
- closeout packet + invoice draft quality gates
- auditability, role boundaries, and operational safety

## Guardrails for all changes

- Keep dispatch state in structured storage, not prompt-only memory.
- Preserve or improve audit coverage for state-changing actions.
- Do not introduce public marketplace skill loading.
- Avoid adding arbitrary shell/OS execution pathways.
- Prefer narrow, role-scoped tools over broad generic tools.

## Development setup

```bash
pnpm install
pnpm build
pnpm check
pnpm test
```

Runtime baseline: Node **22+**.

## Pull request expectations

- Use `E#-F#-S#` at the start of the PR title.
  - Example: `E1-F1-S1: add contracts package`

- Keep scope focused and explain behavioral impact.
- Include tests for logic changes.
- Call out security implications when touching tools, routing, or permissions.
- Mention any closeout/billing behavior changes explicitly.

## Suggested PR checklist

- [ ] Dispatch lifecycle behavior is covered (intake/schedule/onsite/closeout as applicable).
- [ ] Audit events are emitted for state-changing actions.
- [ ] Role permissions remain least-privilege.
- [ ] `pnpm build && pnpm check && pnpm test` passes locally.

## Commit guidance

Use concise, action-oriented commit messages, for example:

- `dispatch: enforce required evidence before closeout`
- `scheduling: persist slot confirmation provenance`
- `intake: normalize channel payload into ticket schema`

## Documentation contributions

When touching docs, keep terminology consistent with the product glossary:

- Ticket / Job
- Case file
- Closeout packet
- Control plane
- Data plane
- Toolset
