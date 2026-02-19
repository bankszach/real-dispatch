# Runbook: Health + Migration Constraint Incident

This runbook is used when `GET /health` returns non-200 from dispatch API.

## 1) Capture baseline health result

```bash
curl -sS http://127.0.0.1:8080/health | jq '.status, .service, .generated_at, .failures'
```

If `service` is not `dispatch-api` or response is not JSON, treat as infrastructure outage and jump to stack recovery.

## 2) Triage DB + migration checks

```bash
docker compose -f dispatch/ops/docker/docker-compose.dispatch.yml \
  exec -T postgres \
  psql -U dispatch -d dispatch -c "
    SELECT
      (SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name='id') ) AS has_tickets_table,
      (SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence_items' AND column_name='is_immutable') ) AS has_evidence_immutable_column,
      (SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='closeout_artifacts' AND column_name='artifact_type') ) AS has_closeout_artifacts_table,
      (SELECT EXISTS(SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname='ticket_state' AND e.enumlabel='CANCELLED') ) AS has_cancelled_enum;
  "
```

## 3) Verify transition constraint expression

```bash
docker compose -f dispatch/ops/docker/docker-compose.dispatch.yml \
  exec -T postgres \
  psql -U dispatch -d dispatch -c "
    SELECT
      conname,
      pg_get_constraintdef(oid) AS constraint_def
    FROM pg_constraint
    WHERE conname = 'chk_ticket_state_transition_valid'
    LIMIT 1;
  "
```

Expected transitions relevant to health checks:

- `DISPATCHED->ON_HOLD`
- `ON_SITE->ON_HOLD`
- `IN_PROGRESS->ON_HOLD`
- `DISPATCHED->SCHEDULED`
- `ON_SITE->SCHEDULED`
- `IN_PROGRESS->SCHEDULED`
- `ON_HOLD->SCHEDULED`
- `COMPLETED_PENDING_VERIFICATION->CLOSED`
- `VERIFIED->IN_PROGRESS`
- `INVOICED->IN_PROGRESS`

Check the raw constraint contains each transition pair with no parser errors.

## 4) Remediation

1. If missing constraints or required rules are detected, re-run migration:

```bash
psql postgres://dispatch:dispatch@127.0.0.1:5432/dispatch -f dispatch/db/migrations/001_init.sql
```

2. Restart API and re-query `/health`.
3. If `migrations.transition_constraint` still fails, inspect recent state changes for out-of-policy transitions.

## 5) Escalate

- Persistent failures after migration rerun.
- Repeated `503` in under 5 minutes under normal traffic.
