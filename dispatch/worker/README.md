# Dispatch Worker Scaffold

Background jobs owned by worker:

- follow-up reminders
- schedule nudges/escalations
- stale ticket detection
- closeout packet assembly tasks
- invoice draft generation retries

Worker jobs must call dispatch-api and emit auditable outcomes.
