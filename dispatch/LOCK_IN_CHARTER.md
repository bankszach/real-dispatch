# Lock-In Charter v1

## Objective

Turn Real Dispatch into a dispatch-first product on top of OpenClaw without state drift.

## Non-negotiables

- case file is source of truth
- closed toolset only for state mutations
- audit event on every mutation
- role-scoped permissions
- no workflow bypass transitions

## Contract lock

- lifecycle: `new -> triaged -> schedulable -> scheduled -> dispatched -> onsite -> closeout_pending -> closed`
- role model: intake, scheduling, technician liaison, closeout
- closure blocked unless closeout checklist gates pass

## Autonomy policy

- autonomy increases only after measured reliability gates pass
- policy changes are proposed by agents but approved by operator
