# Backlog Governance

Canonical active backlog:
- `backlog.csv`

Rules:
- Keep only outstanding work items in `backlog.csv`.
- Do not duplicate full backlog tables in status logs.
- Track completed implementation history in `dispatch/logs/progress_log.md`.

Column guide (`backlog.csv`):
- `Rank`: execution order
- `Epic`: grouping label
- `Item`: unique backlog item identifier + title
- `Type`: work item type
- `Priority`: urgency (`P0`, `P1`, etc.)
- `Status`: `READY`, `IN_PROGRESS`, `BLOCKED`, `DONE`
- `DependsOn`: comma-separated upstream item IDs
- `OwnerRole`: accountable role(s)
- `SprintTarget`: planned sprint window
- `Description`: implementation intent
- `AcceptanceCriteria`: required completion gate
