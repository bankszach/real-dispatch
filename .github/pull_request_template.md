# Pull Request Checklist

Story ID: E#-F#-S#

## How to name PRs

- Use the format `E#-F#-S#:` at the beginning of the title.
- Example: `E1-F1-S1: add contracts package`

## Checklist

- [ ] DoD tests passing (attach command + result)
- [ ] Feature flag status documented (if used)
- [ ] Migrations are safe and rollback-safe
- [ ] Observability notes updated (`logs/metrics/traces` impacted)
- [ ] Rollback notes included
