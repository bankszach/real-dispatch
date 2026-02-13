# Case Lifecycle v1

## States

- new
- triaged
- schedulable
- scheduled
- dispatched
- onsite
- closeout_pending
- closed
- canceled

## Legal transitions

- new -> triaged | schedulable | canceled
- triaged -> schedulable | canceled
- schedulable -> scheduled | canceled
- scheduled -> scheduled | dispatched | canceled
- dispatched -> onsite
- onsite -> closeout_pending
- closeout_pending -> closed

## Closure gate

Ticket cannot transition to `closed` unless required closeout checklist items are complete.
