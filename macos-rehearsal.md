# Native macOS allocation rehearsal (pending)

This lane ran Linux only. A Mac author must run the same portable rehearsal
at the proposed merging head. Linux evidence does not qualify macOS.

Use a **disposable OS account** supplied for this rehearsal and its own local
Docker engine. Do not create the marker in a real development account. Changing
HOME alone does not isolate the store: Silo queries the native account database.
Account creation, Docker setup and deleting that account remain with its owner.
No sudo, credential edits, system reconfiguration or peer cleanup is part of
these commands. Put the checkout and scratch under that account's `~/Work`.

## Prepare and record

In the disposable account, from this checkout:

```sh
export TMPDIR="$PWD/../silo-allocation-macos-tmp"
mkdir -p "$TMPDIR/fixtures" "$TMPDIR/legacy/0.9.0" "$TMPDIR/legacy/0.5.9"
bun --version                    # exactly 1.4.4
janitor version                  # 0.3.1; help must offer --pgroup-only
janitor --help
sw_vers
uname -a
/usr/bin/dscacheutil -q user -a uid "$(id -u)"
docker version
docker context inspect --format '{{.Endpoints.docker.Host}}'
docker info --format '{{.ID}} {{.OSType}}'
k3d version                      # Linux author: 5.9.0 / k3s 1.35.5-k3s1
tilt version
kubectl version --client
bun -e 'import{Database}from"bun:sqlite";console.log(new Database(":memory:").query("select sqlite_version() v").get())'
git rev-parse HEAD
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run check
bun test
bun run build
shasum -a 256 dist/cli.js
```

Record exact tool versions and the filesystem identity/case behavior; different
k3d/Tilt versions are a qualification input, not an automatic pass. Bun uses
native account lookup because 1.4.4's `os.userInfo().homedir` was observed to
follow HOME on Linux. Confirm the regression under macOS:

```sh
HOME="$TMPDIR/scrubbed-home" USER=unrelated LOGNAME=unrelated bun test src/core/allocation_domain.test.ts
```

Only after verifying that this is the disposable account:

```sh
printf 'disposable silo rehearsal account\n' > "$HOME/.silo-rehearsal-account"
curl -fsSL https://registry.npmjs.org/@0xbigboss/silo/-/silo-0.9.0.tgz -o "$TMPDIR/legacy/0.9.0/package.tgz"
curl -fsSL https://registry.npmjs.org/@0xbigboss/silo/-/silo-0.5.9.tgz -o "$TMPDIR/legacy/0.5.9/package.tgz"
shasum -a 256 "$TMPDIR/legacy/0.9.0/package.tgz" "$TMPDIR/legacy/0.5.9/package.tgz"
tar -xzf "$TMPDIR/legacy/0.9.0/package.tgz" -C "$TMPDIR/legacy/0.9.0"
tar -xzf "$TMPDIR/legacy/0.5.9/package.tgz" -C "$TMPDIR/legacy/0.5.9"
```

Expected tarball digests, downloaded by the Linux author:

| Artifact | SHA-256 |
| --- | --- |
| 0.9.0 package.tgz | `34d4c96b6f7a21ec688aa66b561527cfa215633e0743d771261caa7e45dd5c6b` |
| 0.5.9 package.tgz | `bbbbe93f47b4bc537ee28e740d32ba78080a2e2cda82781cf959a269468281a2` |

## Run the same public-CLI scenarios

Run the gate in the foreground. If the host launcher requires a distinct
process group, use that host's approved group launcher and record its returned
PID. The harness records each child handle, exact Docker object and teardown
in its fixture `resources` file. It uses only synthetic data and leaves evidence
under the supplied root; it cleans its stacks before returning.

```sh
bun run test:allocation --root "$TMPDIR/fixtures" --silo "$PWD/dist/cli.js" \
  --legacy09 "$TMPDIR/legacy/0.9.0/package/dist/cli.js" \
  --legacy05 "$TMPDIR/legacy/0.5.9/package/dist/cli.js" \
  > "$TMPDIR/rehearsal.log" 2>&1
cat "$TMPDIR/rehearsal.log"
```

A successful run contains `{"result":"pass","suite":"all"}` **and** no
later cleanup failure, and exits zero. Keep the entire log and fixture evidence.
The suites may be selected independently with `--suite legacy`, `live` or
`backend` when a source change justifies rerunning only affected scenarios.

| Scenario driven by that command | Required observation |
| --- | --- |
| Old 0.9.0 lock-only entry in account registry, scrubbed HOME registry, explicit registry | env/up/ci/down/status in both old and unrelated roots return LEGACY_STATE and list the entry; trees and existing store bytes unchanged. |
| Pre-registry malformed root lock | Refusal without changes, even with no JSON entry. |
| Reverse lock-only and paused old publication | The genuine 0.9.0 artifact pauses before registration; the procedure waits, drains it, then old down; only afterward does the new peer allocate. No claim is made while legacy state exists. |
| Old 0.9.0 and 0.5.9 after cutover | Record their actual assignments and overlaps as unsupported limits; SQLite bytes/claims stay unchanged; visible JSON makes new status refuse. Never call this mixed-version isolation. |
| Concurrent A/B env then live stacks | Disjoint ports and names; matching repeated up is a no-op; live force/profile change refuses; B's logical state and HTTP identity survive A clean/crash/recovery. |
| Squatter after reservation | Non-silo listener survives, CI reports PORT_BIND_CONFLICT, exported ports do not change, clean retains claims until the fixture listener stops. |
| Crash after rename before checkpoint | Test-only SQLite boundary fault kills the real built CLI after its actual filesystem effect; down resumes only the journaled inode and cleans; peer unchanged. No production test bypass exists. |
| Shared output/case-folded leaf | Public env refuses a cross-role/nested-root target alias without changing peer bytes. |
| Native root spelling aliases | Existing case/Unicode normalization aliases resolve to one project; distinct spellings on case-sensitive filesystems remain distinct. |
| Same-name leftover network/volume/stopped k3d server/registry containers | NAME_CONFLICT; exact C object IDs, creation identities and bytes remain unchanged; C is removed only by the harness's exact fixture handle. Stopped server/registry containers are synthetic native Docker residues, not running C clusters. |
| Unreceipted env/kubeconfig/version-2 lock | PATH_CONFLICT and sentinels unchanged; legacy version-1 locks use LEGACY_STATE. |
| Native k3d creation/retention/deletion | Exact node/registry/network/volume receipts, owned kubeconfig; clean refuses retained resources; explicit deletion removes only journaled objects. |
| k3d enabled to disabled after exact cluster deletion | `env --force` refuses removal of the published kubeconfig role; its original path/bytes and all claims survive. `down --clean` removes that recorded snapshot despite the config edit; subsequent disabled allocation has no kubeconfig claim, and final cleanup leaves no claims. |
| Owner-labelled object outside namespace | NAME_CONFLICT; cleanup cannot grant authority outside declared names; the harness removes its exact synthetic object. |
| Docker unavailable | ENGINE_UNAVAILABLE, never an empty-namespace pass. |

Repeat the same command on **both case-insensitive and case-sensitive native
filesystems**, using locations supplied by the Mac account owner (no disk or
volume creation is authorized here). Keep the same canonical account store;
use disjoint fixture roots. Record the harness's CaseRoot/caseroot and
NFC/NFD observations. Also run the filesystem tests from each checkout:

```sh
bun test src/core/lease_store.test.ts src/core/legacy_check.test.ts
```

The lease tests include one-failure parent-fsync faults for publish and delete,
plus short and interrupted CI appends. Both sync retries must reach a successful
native directory fsync before clearing the pending receipt. An uncertain CI
append must retain claims through both reallocation and retirement attempts.
Run these tests natively on each filesystem mode; Linux does not qualify
Darwin's directory-sync behavior.

## Full example and guest

Copy `example/` into another owned scratch root. Run the built CLI against
that copy, never an existing project:

```sh
silo_artifact="$PWD/dist/cli.js"
cp -R example "$TMPDIR/example"
cd "$TMPDIR/example"
bun "$silo_artifact" ci macos-example --timeout 300s
# Save status, inspect available web/api deployments with the exported KUBECONFIG,
# and query /health through that cluster's service proxy.
# Keep silo_artifact for status and down --delete-cluster --clean.
```

Use `silo status --json` to save exact receipts. Source only this generated env
file, then `kubectl wait --for=condition=available --timeout=30s deployment/web
deployment/api` and `kubectl get --raw
/api/v1/namespaces/default/services/web:3000/proxy/health` (and api:8080).
Use the same absolute CLI for `down --delete-cluster --clean`; record all exact
resource IDs absent afterward. The example passes Compose project_name
explicitly and labels its service/network; do not remove those settings.

Invite a fresh guest using the standard guest charter, the built CLI, packaged
skill and a distinct disposable fixture. Include stop/recreate from a legacy
refusal, parallel roots, live force refusal and retained clean behavior. Give
no diff or author reasoning. A guest's run does not replace this author run.

## Finish

Record head, artifact digest, OS/FS/tool versions, each observation and exact
resources removed. Preserve failures. Mac results stay pending for any scenario
not actually driven. Do not weaken a failed assertion or remove receipts to
make clean pass. No tag, release, npm publish, merge, credential change or real
host cutover belongs to this rehearsal. Hand evidence to the coordinator and
matching cross-provider specialist. Tear down every recorded owned process
and object, confirm none remain, then remove the owned scratch tree with
`rm -r` only after its evidence has been retained in the change record.
