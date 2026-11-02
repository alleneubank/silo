# Hosts

This document describes host configuration and browser isolation. It is bundled
with the CLI and can be printed with:

```
silo doc hosts
```

## Purpose

Browser cookies are shared across `localhost` ports. silo uses `*.localhost`
subdomains to isolate cookies across instances and services.

Example:

- `http://main.localhost:3000`
- `http://feature-x.localhost:3001`

## Configuration

```toml
[hosts]
APP_HOST = "${name}.localhost"
ADMIN_HOST = "admin.${name}.localhost"
API_HOST = "api.${name}.localhost"
```

## Defaults

If `[hosts]` is omitted, silo injects:

```toml
[hosts]
APP_HOST = "${name}.localhost"
```

## Built-In Hosts

- `TILT_HOST` defaults to `APP_HOST` when omitted. An explicit value is preserved.

For a loopback Tilt UI while preserving the application's browser hostname:

```toml
[hosts]
APP_HOST = "${name}.localhost"
TILT_HOST = "127.0.0.1"
```

## Interpolation Rules

Host templates can only reference identity variables (`name`, `prefix`,
`WORKSPACE_NAME`, `COMPOSE_PROJECT_NAME`). Ports and URLs are not available when
hosts are resolved.
