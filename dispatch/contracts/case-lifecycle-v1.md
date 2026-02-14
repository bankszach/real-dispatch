# Case Lifecycle v1

This contract defines the operator-facing lifecycle phases and their mapping to
dispatch-api enforcement states.

## 1) Operator-Facing Phase Lifecycle

- new
- triaged
- schedulable
- scheduled
- dispatched
- onsite
- closeout_pending
- closed
- canceled

Legal phase transitions:

- new -> triaged | schedulable | canceled
- triaged -> schedulable | canceled
- schedulable -> scheduled | canceled
- scheduled -> scheduled | dispatched | canceled
- dispatched -> onsite
- onsite -> closeout_pending
- closeout_pending -> closed

## 2) dispatch-api Enforcement States

- NEW
- NEEDS_INFO
- TRIAGED
- APPROVAL_REQUIRED
- READY_TO_SCHEDULE
- SCHEDULE_PROPOSED
- SCHEDULED
- DISPATCHED
- ON_SITE
- IN_PROGRESS
- ON_HOLD
- COMPLETED_PENDING_VERIFICATION
- VERIFIED
- INVOICED
- CLOSED

## 3) Phase-to-State Mapping

| Phase | Enforcement states |
|---|---|
| `new` | `NEW`, `NEEDS_INFO` |
| `triaged` | `TRIAGED`, `APPROVAL_REQUIRED` |
| `schedulable` | `READY_TO_SCHEDULE`, `SCHEDULE_PROPOSED` |
| `scheduled` | `SCHEDULED` |
| `dispatched` | `DISPATCHED` |
| `onsite` | `ON_SITE`, `IN_PROGRESS`, `ON_HOLD` |
| `closeout_pending` | `COMPLETED_PENDING_VERIFICATION`, `VERIFIED`, `INVOICED` |
| `closed` | `CLOSED` |
| `canceled` | Currently represented as `CLOSED` with cancellation reason metadata until a dedicated cancel state is introduced. |

## 4) Closure Gate

Ticket cannot transition to `closed` unless required closeout checklist items are complete.
