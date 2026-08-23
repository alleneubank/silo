# Tilt Integration

This document describes how silo interacts with Tilt. It is bundled with the
CLI and can be printed with:

```
silo doc tilt
```

## Expectations

- A `Tiltfile` is expected in the current directory.
- `tilt` must be installed and on your PATH.

## Startup

`silo up` starts Tilt in the foreground with:

```
tilt up
```

silo passes all generated env vars to Tilt, plus these markers so the Tiltfile
can detect a silo-managed run:

- `SILO_ACTIVE=1`
- `SILO_WORKSPACE=<workspace name>`
- `SILO_ENV_FILE=<absolute path to generated env file>`

The process runs in the same terminal, and `Ctrl+C` stops Tilt.

## Shutdown

`silo down` runs `tilt down` (with a timeout) and then stops any tracked Tilt
PID if still running.

## Env File Usage

silo writes an env file and also exports the same vars when running Tilt. Your
Tiltfile can read the file directly (for example with a dotenv extension) or
use the process environment.

## Registry Auto-Discovery

When registry advertisement is enabled (k3d registry or top-level `registry`),
silo writes the `local-registry-hosting` ConfigMap so Tilt can auto-discover the
local registry without `default_registry()`. See `silo doc k3d` for details.

## Silo Requirement (Tilt Extension)

If your Tiltfile must only run under `silo up`, you can load the bundled
side-effect extension and enforce it with one line.

Local (this repo):

```
load('./tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
```

From npm (recommended for CI and other non-interactive environments):

```
load('./node_modules/@0xbigboss/silo/tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
```

CI environments often run without GitHub HTTPS clone credentials, so this local
`node_modules` path avoids `extension_repo()` clone/auth failures.

From a GitHub-hosted extension repo:

```
v1alpha1.extension_repo(name='silo', url='https://github.com/alleneubank/silo')
v1alpha1.extension(name='silo-require', repo_name='silo', repo_path='tilt-extensions/silo/require')
load('ext://silo-require', 'SILO_REQUIRE')
```

Note: `repo_path` belongs on `v1alpha1.extension()`, not `extension_repo()`.
This pattern requires Git credentials for HTTPS clone access.

If the extension is published to the default Tilt extensions repo, you can
skip `extension_repo` and just use the `load('ext://...')` line.
