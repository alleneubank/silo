# Design: silo ships its own Janitor

Status: **approved by the owner 2026-11-20** (question tool: "Ship it inside
silo (Recommended)"). Drafted from `origin/main` fce6d5c (silo 1.3.0).

## Owner decision

Allen, 2026-11-20, in conversation, after aem5's global silo 1.3.0 could not
launch because `janitor` resolved to a version-manager shim with no version:

> "i forgot that it requires janitor CLI. lets build that into silo then
> rather than requriing another CLI."

## Why

Every mutating silo command runs its tool under Janitor, a Zig process-group
supervisor that outlives silo and drains the group if silo dies. silo found
`janitor` on `PATH` and qualified only 0.3.1, so every host and project had to
install and pin a second CLI: op-forward pins it in `toolchain.toml`, CI and
release workflows install it, and a global silo fails at launch where no
Janitor resolves (aem5, 2026-11-20). Nothing checked that the `PATH` Janitor
was the qualified version.

## Users and their tasks

| User | Task | What they need |
| --- | --- | --- |
| Anyone installing silo (npm, bun, mise) | Run `silo up` or `silo run` | Nothing beyond Bun; Janitor comes with silo |
| A standalone (`bun build --compile`) silo user | Same | The executable carries Janitor too |
| A Janitor developer | Try a Janitor build under silo | One documented override |
| silo's own tests | Substitute a stalled or refusing supervisor | The same override |

## Design

- `src/core/janitor_release.ts` pins one Janitor release: its version and,
  per platform (macOS arm64/x86_64, Linux aarch64/x86_64), the release
  archive's name and SHA-256 and the extracted binary's SHA-256.
- `scripts/fetch-janitor.ts` downloads each archive from the GitHub release,
  checks both digests and writes `vendor/janitor/<platform>/janitor`
  (gitignored). It is idempotent and runs as the package's `prepare` script, so
  `bun install` in a checkout, CI and `npm publish` all have the binaries.
- `src/core/janitor.ts` imports the four binaries as Bun file assets. Bun copies
  them beside `dist/cli.js` for the npm package and embeds them in a standalone
  executable. Neither form can be executed in place (the asset loses its mode;
  the embedded file lives in `/$bunfs`), so on first use silo copies the host's
  binary to `<account home>/.silo/janitor/<version>-<binary sha256 prefix>/janitor`
  (temporary file, mode 0755, rename), after checking its bytes against the
  pinned digest. Later launches reuse that file.
- silo never looks up `janitor` on `PATH`. `SILO_JANITOR=<path>` replaces the
  bundled binary for one invocation; it exists for Janitor development and
  silo's own supervisor-failure tests.
- An unsupported platform refuses with `LAUNCH_FAILED` naming the supported
  ones, before any effect.
- `silo prepare` no longer lists `janitor` among required tools.

### States

| State | Result |
| --- | --- |
| First launch for this account and Janitor build | Copies the binary, then launches |
| Copy already present | Launches it |
| Two silo processes copy at once | Each renames its own complete file; same bytes |
| Embedded bytes do not match the pinned digest (broken build) | `LAUNCH_FAILED`, nothing launched |
| Account home not writable | `LAUNCH_FAILED` naming the path |
| `SILO_JANITOR` set | That file is executed as is |

## Compatibility

- No CLI, config or store change. Janitor's version and arguments are
  unchanged (0.3.1, `--pgroup-only`).
- A Janitor on `PATH` is no longer used; projects may drop their Janitor pin
  once they require this silo (op-forward's `toolchain.toml`).
- The npm package grows by the four binaries (about 7.5 MB unpacked, 2.3 MB
  compressed).

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| Per-platform npm packages as optional dependencies (esbuild/bun pattern) | Four new npm artifacts and a release pipeline in the Janitor repo; some installers skip optional dependencies; standalone builds still need another path |
| Rewrite the supervisor in TypeScript (silo re-execs itself) | Reimplements proven process-safety code on a runtime without `setsid`/process-tree primitives |
| Binaries in the package, executed in place | Needs the npm exec bit to survive every installer, and does not work for standalone builds |
| Commit the binaries to git | 7.5 MB per Janitor version in history; the pinned digests already make the fetch reproducible |
| Keep `PATH` as a fallback | Two resolution paths, and an unqualified Janitor version can win |

## Verification

- Unit: platform selection, digest mismatch refusal, idempotent copy, override.
- Existing native launch tests run the bundled Janitor instead of `PATH`.
- Packed tarball installed with npm and bun into a clean prefix with no
  `janitor` on `PATH`: `silo run` on macOS (aem5) and Linux (VM).
- Standalone executable: same run.
- Specialist review before merge (public package contract, process supervision).

## Decision log

- 2026-11-20 (owner, in conversation and question tool): ship Janitor inside
  silo; no `PATH` lookup.
