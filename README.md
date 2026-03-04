# silo

Isolated local development environments. silo solves instance isolation and k3d bootstrap sequencing for Tilt-based projects.

![silo version](docs/screenshot.png)

## Requirements

- Bun (runtime)
- Tilt
- k3d (optional, only if `k3d.enabled = true`)

## Install

```bash
npm i -g @0xbigboss/silo
```

### Claude Code Skill

Install the silo skill in [Claude Code](https://claude.ai/code) so your AI assistant knows how to use silo:

```bash
/plugin marketplace add 0xBigBoss/silo
/plugin install silo@0xBigBoss-silo
```

## Quick start

```bash
silo init
# edit silo.toml
silo up dev
```

Print the bundled `silo.toml` reference:

```bash
silo doc config
```

## Commands

```bash
silo init            # Create silo.toml starter config
silo up [name]       # Start environment (creates k3d if needed, starts Tilt)
silo down            # Stop environment (stops Tilt, keeps k3d by default)
silo status          # Show current instance state
silo env [name]      # Generate env file only, don't start anything
silo ci [name]       # Run Tilt in CI mode (tilt ci) after env + k3d setup
silo profiles        # List available profiles
silo doc [topic]     # Print bundled docs (config, profiles, k3d, hooks, etc.)
silo version         # Print version
```

## Configuration

`silo.toml` defines ports, hosts, URLs, k3d settings, and hooks. For the canonical reference, run:

```bash
silo doc config
```

You can also browse `SPEC.md` for a detailed specification.

## Child process environment

When silo launches child processes (Tilt, hooks, k3d, kubectl), it injects:

- `SILO_ACTIVE=1`
- `SILO_WORKSPACE=<workspace name>`
- `SILO_ENV_FILE=<absolute path to generated env file>`

## CI usage

`silo env` and `silo ci` auto-export env vars to `$GITHUB_ENV` when running in
CI (or when `--export-ci` is provided):

```bash
silo ci e2e --timeout 300s
```

If your `Tiltfile` uses the silo requirement extension in CI, prefer loading it
from installed dependencies instead of `v1alpha1.extension_repo()`:

```python
load('./node_modules/@0xbigboss/silo/tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
```

## License

MIT
