# Tilt Integration

This document describes how silo interacts with Tilt. It is bundled with the
CLI and can be printed with:

```
silo doc tilt
```

## Lifecycle vs Tilt API

silo starts, stops, and isolates Tilt. It does not wrap the Tilt API.

| Job | Tool |
| --- | --- |
| Ports, env, k3d, hooks, start/stop | `silo up` / `down` / `env` / `ci` / `status` |
| Resource health, logs, wait, trigger | `tilt get` / `logs` / `wait` / `trigger` |

`silo status` reads the canonical ownership store (generation, claims, receipts,
pid, ports, URLs). Process liveness is not
resource health. The API may not be on 10350; pass `--port` from `TILT_PORT`
in the env file (default `.localnet.env`):

```
tilt get uiresources --port "$TILT_PORT"
```

Do not run `tilt up` or `tilt down` while silo owns the stack. Do not run
`silo up` again for code or Tiltfile edits — Tilt reloads those itself.

## Expectations

- A `Tiltfile` is expected in the current directory.
- `tilt` and [janitor](https://github.com/alleneubank/janitor) must be on PATH.
- Config, hooks and Tiltfiles are trusted and must use the generated names,
  ports and kubeconfig. Silo does not sandbox arbitrary tool behavior.

For Compose, pass the generated project name explicitly. Tilt's default is
the directory name; its API does not default to `COMPOSE_PROJECT_NAME`:

```python
docker_compose('docker-compose.yaml', project_name=os.getenv('COMPOSE_PROJECT_NAME'))
```

Label generated Compose services, networks and volumes with
`io.silo.project: "${SILO_PROJECT_ID:?run through silo}"` and
`io.silo.generation: "${SILO_GENERATION:?run through silo}"` in the Compose
file. The example demonstrates service and default-network labels. Use only
the claimed project namespace; an owned label on an object outside it causes
`NAME_CONFLICT` and blocks cleanup. Silo never grants deletion authority for
that object. See the [Tilt API reference](https://docs.tilt.dev/api.html#api.docker_compose).

## Startup

`silo up` starts Tilt in the foreground under
[janitor](https://github.com/alleneubank/janitor):

```
janitor --pgroup-only --watch-pid <silo-pid> --grace-ms <ms> -- bun <silo-entrypoint> __silo_execute ...
```

janitor is a required tool. A missing supervisor fails the run rather than
starting an unsupervised Tilt. The executor opens its tool gate only after a
durable grant records the actual process group. The snapshot's `tiltPid` is
the supervisor PID. Janitor drains its owned group on owner loss; uncertain
outcomes retain claims until `down` can prove reconciliation.

silo passes all generated env vars to Tilt, plus these markers so the Tiltfile
can detect a silo-managed run:

- `SILO_ACTIVE=1`
- `SILO_WORKSPACE=<workspace name>`
- `SILO_ENV_FILE=<absolute path to generated env file>`

The process runs in the same terminal, and `Ctrl+C` stops Tilt.

`silo ci` uses the same gated supervisor for `tilt ci`. CI exit does not
release resource/port ownership; run `down` to reconcile and `--clean` to
retire only when resources are absent.

For an explicit loopback UI with embedded production assets:

```toml
[hosts]
APP_HOST = "${name}.localhost"
TILT_HOST = "127.0.0.1"

[tilt]
webMode = "prod"
```

silo adds exactly `--web-mode=prod` to `tilt up` and `tilt ci`. Without
`tilt.webMode`, Tilt chooses its existing default. silo does not set
`TILT_WEB_MODE`. Other configured values are rejected; CI passthrough cannot
override an explicit mode. This flag selects web assets, not listener access
policy; inspect actual listeners when validating a private deployment.

## Shutdown

`silo down` stops verified recorded groups and deletes recorded Docker IDs with a
timeout. Teardown errors propagate. It never scans for arbitrary Tilt PIDs.
Keep lifecycle commands inside Silo. A matching live `up` reuses it;
`--force` cannot start another stack in that root. Parallel stacks need
separate roots and names.

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
