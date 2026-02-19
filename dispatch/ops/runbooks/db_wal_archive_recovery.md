# Runbook: WAL Archive, PITR, and Recovery

This runbook defines a baseline operational path when point-in-time recovery is required.

## 1) Verify WAL archival state

```bash
docker compose -f dispatch/ops/docker/docker-compose.dispatch.yml \
  exec -T postgres \
  psql -U dispatch -d dispatch -c "
    SELECT name, setting, source
    FROM pg_settings
    WHERE name IN ('archive_mode', 'archive_command', 'wal_level', 'max_wal_size', 'wal_keep_size')
    ORDER BY name;
  "
```

Required behavior for recovery readiness:

- `archive_mode` = `on`
- `wal_level` = `replica`
- `archive_command` points to durable storage
- `wal_keep_size` is non-zero for short-lived outage recovery

If any value differs, page the platform owner for config change before accepting changes.

## 2) Confirm WAL archive continuity

```bash
docker compose -f dispatch/ops/docker/docker-compose.dispatch.yml \
  exec -T postgres \
  psql -U dispatch -d dispatch -c "SELECT pg_current_wal_lsn(), pg_current_wal_insert_lsn();"
```

Capture `lsn` plus archive directory listing before maintenance windows.

## 3) Controlled recovery playbook

1. Stop write traffic:
   - pause worker and API process, then stop dispatch stack write path.
2. Take emergency snapshot + last base backup.
3. Rebuild target Postgres on clean volume.
4. Restore the chosen backup and configure recovery target:

```bash
touch /var/lib/postgresql/data/recovery.signal
cat >> /var/lib/postgresql/data/postgresql.auto.conf <<'EOF'
restore_command = 'cp /path/to/wal/archive/%f %p'
recovery_target_timeline = 'latest'
EOF
```

Use `restore_command` to pull archived WALs and set timeline/recovery target fields in
`postgresql.auto.conf` as required by the incident run.

5. Restart Postgres and verify WAL replay reaches expected recovery point.
6. Replay API-level health checks:

```bash
curl -sSf http://127.0.0.1:8080/health
```

7. Compare restored state row counts with pre-incident backup metadata.

## 4) Escalation signals

- Missing archive segments beyond recovery target window
- `pg_wal` growth without corresponding `archive_command` writes
- Recovery command stalls before `restore` completion

Escalate if any of the above persists beyond your RTO window.
