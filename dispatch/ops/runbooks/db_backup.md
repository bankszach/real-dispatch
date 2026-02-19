# Runbook: Database Backup

Baseline:

- `postgres` service from `dispatch/ops/docker/docker-compose.dispatch.yml`
- production database URL: `postgres://dispatch:dispatch@postgres:5432/dispatch` (inside compose) or
  `postgres://dispatch:dispatch@127.0.0.1:5432/dispatch` (host exposed usage)

## 1) Backup location and naming

Use UTC timestamps and immutable file names:

```bash
mkdir -p dispatch/reports/db-backups
export BACKUP_NAME="dispatch-$(date -u +%Y%m%dT%H%M%SZ).dump"
export BACKUP_PATH="dispatch/reports/db-backups/${BACKUP_NAME}"
```

## 2) Take a compressed base backup

```bash
docker compose -f dispatch/ops/docker/docker-compose.dispatch.yml \
  exec -T postgres \
  pg_dump -Fc -U dispatch -d dispatch > "${BACKUP_PATH}"
```

## 3) Validate backup integrity

```bash
pg_restore --list "${BACKUP_PATH}" | head -n 20
```

If `pg_restore` cannot read the archive, discard and retry the backup.

## 4) Validate payload after backup (optional)

```bash
docker compose -f dispatch/ops/docker/docker-compose.dispatch.yml \
  exec -T postgres \
  psql -U dispatch -d dispatch -c "SELECT now() as backup_at, count(*) AS ticket_count FROM tickets;"
```

Record `(ticket_count, BACKUP_PATH)` in backup inventory.

## 5) Recovery test spot-check (post-change drill)

- Spin up a temporary scratch DB and restore the backup:

```bash
restore_db="dispatch_restore_$(date -u +%s)"
createdb -T template0 -U dispatch "${restore_db}"
pg_restore -U dispatch -d "${restore_db}" "${BACKUP_PATH}"
```

- Verify schema exists:

```bash
pg_restore -l "${BACKUP_PATH}" | grep -q "TABLE tickets"
```

## 6) Retention guidance

- Keep at least 30 daily backups on local disk for the first pass.
- Archive critical backups off-host as soon as the backup objective is accepted.
- Verify at least one restore test per week.
