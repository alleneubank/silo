# Lifecycle Hooks

This document describes lifecycle hooks. It is bundled with the CLI and can be
printed with:

```
silo doc hooks
```

## Configuration

```toml
[hooks]
pre-up = ["./scripts/check-deps.sh"]
post-up = ["./scripts/seed-db.sh"]
pre-down = ["./scripts/backup-state.sh"]
post-down = []
```

## Execution

- Hooks run sequentially, in order listed.
- Hooks run via `/bin/sh -c` from the project root.
- Hooks inherit all generated environment variables.
- Each hook has a 5 minute timeout.
- Each hook holds the project operation and uses a durable gated Janitor
  process group (`--pgroup-only`). Do not detach descendants or mutate peer
  resources. Hook code is trusted; Silo cannot infer arbitrary hook ownership.

## Failure Behavior

- `pre-up` failure: aborts before k3d is created or Tilt starts.
- `post-up` failure: aborts before Tilt starts.
- `pre-down` failure: aborts teardown.
- `post-down` failure: propagates; claims remain for reconciliation.
