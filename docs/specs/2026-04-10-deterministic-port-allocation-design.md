# Deterministic Port Allocation for Multi-Worktree Isolation

Tracking: [0xsend/silo#1](https://github.com/0xsend/silo/issues/1)
Date: 2026-04-10
Status: Proposed

## Problem

Two silo instances on the same machine that allocate ports back-to-back get
overlapping port sets because `allocatePorts` uses live free-port detection
only. The ephemeral scan always begins at `EPHEMERAL_PORT_START` (49152), so
the second instance picks the same first-free port the first instance picked a
moment earlier — they don't actually collide until someone binds.

Reproduction (from the `sendapp-multi-worktree-poc`):

```
wt-a: NEXTJS_PORT=49152  ANVIL_MAINNET_PORT=49160  TEMPORAL_PORT=49166  ...
wt-b: NEXTJS_PORT=49152  SUPABASE_API_PORT=49160  SUPABASE_STUDIO_PORT=49166 ...
```

Runtime impact: the second instance's Tilt/next/temporal processes hit
EADDRINUSE as soon as the first instance starts binding.

## Goals

1. Two silo instances with different names get disjoint ephemeral port
   ranges on a cold machine (nothing bound).
2. Allocation is deterministic per instance name — reruns without a lockfile
   produce the same ports when ports are free.
3. Behavior for configured default ports and lockfile reuse is unchanged.
4. Existing tests pass. No regression on the loopback detection fix shipped
   in 0.5.8.

## Non-Goals

- A machine-wide live registry of allocated ports (see Alternatives).
- Coordination across multiple machines.
- Guaranteed no-collision with arbitrary user-picked default ports.

## Design

### Slotted hash seeding

Hash the instance name to pick a starting slot within the ephemeral range.
Scan from that slot (with wrap-around) until a free port is found. Configured
defaults and lockfile reuse continue to take precedence.

```
blockSize  = 64                                          // >> typical ports per instance
rangeSize  = EPHEMERAL_PORT_END - EPHEMERAL_PORT_START + 1   // 16384
numSlots   = floor(rangeSize / blockSize)                // 256
slotIndex  = hash(name) % numSlots
startAt    = EPHEMERAL_PORT_START + slotIndex * blockSize
```

A typical silo.toml defines ~10–30 ports per instance. A 64-port slot leaves
room for growth while still giving 256 distinct slots. With two worktrees the
probability of slot collision is ~0.4%; with five worktrees, ~4%. When a
collision does occur the existing free-port check still detects it — disjoint
slotting is an optimization, not a correctness guarantee.

### Wrap-around scan

`findEphemeralPort` currently scans `[startAt, EPHEMERAL_PORT_END]`. With
hash-seeded starts, a high `startAt` would truncate the scan. Change to scan
the full ephemeral range starting at `startAt`, wrapping back to
`EPHEMERAL_PORT_START` after the end.

### Hash function

Use a simple non-cryptographic hash (FNV-1a 32-bit). Deterministic across
platforms, no dependencies, collision characteristics are fine for 256-slot
distribution.

### API change

`allocatePorts` gains an optional `instanceName: string` parameter. When
omitted (as in most existing tests), start continues to be
`EPHEMERAL_PORT_START` — preserves current test expectations. When provided,
`startAt` is computed from the hash.

`buildInstanceState` in `src/core/instance.ts` already has the instance
`name`; thread it through.

## Data flow

```
buildInstanceState(name, ...)
    └─> allocatePorts({ instanceName: name, ... })
            ├─> startAt = EPHEMERAL_PORT_START
            │             + (fnv1a(name) % numSlots) * blockSize    (if name provided)
            └─> findEphemeralPort(..., startAt, wrapAround=true)
```

## Testing

Unit tests in `src/core/ports.test.ts`:

- **Determinism**: same instance name → same ports across two invocations
  (with `isPortFree` always-true).
- **Disjointness**: two different well-known names (`wt-a`, `wt-b`) → disjoint
  port ranges.
- **Backward compatibility**: when `instanceName` is omitted, allocation still
  starts at `EPHEMERAL_PORT_START`.
- **Wrap-around**: instance name hashing to a slot near the end of the range
  still allocates successfully when the tail is occupied.
- **Lockfile precedence**: lockfile ports win even if the hash-seeded start
  would pick a different value.
- **Default precedence**: configured defaults win over hash-seeded start.

## Alternatives considered

### Machine-wide registry (`~/.silo/registry.json`)

Maintain a JSON file listing every live silo instance's allocated ports.
Strongest guarantee but requires cross-process file locking, stale-entry GC,
and handles recovery on crashes. Too much machinery for the benefit.

### Random per-run start

Pick a random `startAt` each invocation. Fixes collisions but makes results
non-reproducible — bad for debugging and for the "run gen-env twice, get the
same ports" expectation.

### Pure slot assignment without free-port check

Skip the free-port probe inside the slot. Faster but loses the safety net
against actually-bound ports. Rejected — the probe is cheap and load-bearing.

## Migration / compatibility

- No config changes. No lockfile format changes.
- Existing instances with a lockfile continue to reuse their stored ports.
- `--force` re-allocates from the hash-seeded start, which may shift ports for
  an existing instance. Called out in docs/ports.md.

## Open questions

None.
