# Contributing

## Development

Requires [Bun](https://bun.sh), [Tilt](https://tilt.dev), and
[janitor](https://github.com/alleneubank/janitor). k3d is optional unless the
project under test enables it.

```bash
bun install
bun test
bun run typecheck
bun run lint
./silo version
```

Nix users can enter the same toolchain with `nix develop` (or direnv, via the
tracked `.envrc`).

The example stack is the live e2e:

```bash
cd example
../silo ci ci-run --timeout 300s
../silo down --delete-cluster --clean
```

Do not commit `.localnet.env`, `.silo.lock`, or `.envrc.private`.

## Changes

Use conventional commits (`feat`, `fix`, `docs`, `ci`, `chore`, …). User-facing
changes need a changeset:

```bash
bun run changeset
```

GitHub Actions opens a Release PR when changesets land on `main`. Merging that
PR publishes `@0xbigboss/silo` to npm via trusted publishing (OIDC, no npm
token).

## Pull requests

- PRs run unit tests, typecheck, and lint (`ci.yml`) plus the example e2e
  (`e2e-example.yml`).
- Keep the change scoped. Standing docs are `README.md`, `SPEC.md`, and
  `docs/` (also printed by `silo doc`).
