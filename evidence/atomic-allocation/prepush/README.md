# Real-push and supervisor startup evidence

Executable source: `80f4974d0f9e2db056ceb7ba771fe12597d5afad`.
CLI SHA-256: `9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894`.
Author: lane silo-impl, ae-dev, 2026-11-04. Linux x86_64/ext4,
Bun 1.4.4, Janitor 0.3.1 (`f9d8de4`), Git 2.55.0, Lefthook 2.1.10,
Tilt 0.37.8-fork.20261009.g753c01455. The allocation plan/threat model and
merge/release holds in the [parent record](../README.md) remain binding.

## Outcome and boundary

Addendum 3 reported three pre-grant handshake failures during real Git pushes.
The native Linux reproduction identifies an unconfigured mise Janitor shim:
it exits before an executor is started, and the launch error discarded its
stderr. No evidence justifies weakening the handshake or its durable-grant
ordering. The correction keeps the existing drain, error code and original
cause, and adds a bounded diagnostic, supervisor exit code, launch identity
and generation. All claims and launch/grant transitions remain unchanged.

The environment correction selects the installed Janitor binary on PATH.
The native test suite now fails in a fixture-directory preflight when that
dependency cannot run, before allocating its test generations. No test is
skipped, retried to obtain a pass, or loosened. No global tool/credential
configuration was changed.

The original coordinator logs did not capture their resolved Janitor path or
supervisor stderr. The controlled Linux reproduction establishes this cause
for the reproduced failures, not an independent attribution of the original
macOS failure. That cause remains open until the Mac preflight and actual
push run. This record does not assert a Git-specific product defect was found.

## Controlled reproduction

Owned scratch was `<lane root>-tmp/addendum3`; the only Git destination was
its newly initialized `push.git`. No fetch, network push or ls-remote ran.

| Input / surface | Observation | Record |
| --- | --- | --- |
| Unchanged bf51f59, real local-bare push, native Janitor on PATH | 129 pass; knip and jscpd pass; local destination receives the exact ref | [push-before.log](push-before.log) |
| Same source and push, native Janitor directory removed from PATH | Same three handshake failures, 126 pass / 3 fail; push refused | [push-shim.log](push-shim.log) |
| Same failing PATH with temporary stderr instrumentation | Each failed launch reports mise `No version is set for shim: janitor`; temporary instrumentation removed before correction | [push-shim-diagnostic.log](push-shim-diagnostic.log) |
| Plain focused native gate test, failing PATH | Same handshake failure outside Git | [plain-shim-before.log](plain-shim-before.log) |
| Git SSH transport, native Janitor, local receive-pack | 129 pass and successful local ref transfer; a strict temporary SSH shim executed the owned local receive-pack without a network connection | [push-ssh-before.log](push-ssh-before.log) |

The native invocation used:

```sh
export PATH=/home/ae/.local/share/mise/installs/bun/1.4.4/bin:/home/ae/.local/share/mise/installs/github-alleneubank-janitor/0.3.1:$PATH
export TMPDIR="$PWD/../boss-mobile-release-silo-impl-tmp/addendum3"
git push "$TMPDIR/push.git" feat/atomic-allocation:refs/heads/verified
```

The failing control retained the Bun binary directory and omitted the Janitor
binary directory, leaving its existing mise shim. The failure did not depend
on changed GIT_DIR, stdin, a mock launch gate, or skipped hook commands.

## Regression and author rehearsal

The permanent contract case supplies a refusing supervisor executable. It
asserts the diagnostic/exit status received by the caller, the absent tool
sentinel, planned launch and retained claims. Its sentinel uses the shell's
`printf` builtin so execution is detectable even with the deliberately isolated
PATH. It fails against unchanged product code
([diagnostic-builtin-red.log](diagnostic-builtin-red.log)) and passes after the
correction ([diagnostic-builtin-green.log](diagnostic-builtin-green.log)). The
earlier case used external `touch`, which could itself be unavailable on that
PATH; author verification corrected that oracle before closeout and retained
both original and final observations. That fixture replaces
only the external supervisor's startup failure; it does not qualify Janitor.
The real Janitor and public CLI are exercised separately below.

| Check / scenario | Observation | Record |
| --- | --- | --- |
| Native fixture preflight with unconfigured shim | Fails early and names the missing runnable Janitor configuration | [preflight-shim.log](preflight-shim.log) |
| Focused lease suite with native Janitor | 28 pass, zero fail; original durable-grant and failed-checkpoint cases remain intact | [lease-suite.log](lease-suite.log) |
| Actual push of committed 80f4974 | 130 pass / zero fail; knip and jscpd pass, zero clones; `verified` ref resolves to the full source SHA above | [push-after.log](push-after.log) |
| Typecheck, lint, build, commit hooks | Pass | [typecheck.log](typecheck.log), [lint.log](lint.log), [build.log](build.log), [commit-code.log](commit-code.log) |
| Author drives built CLI with actual unconfigured mise shim | Public CI reports underlying error, supervisor exit 1 and launch identity; pre-up sentinel absent, claims and env bytes unchanged | [public-final.log](public-final.log) |
| Native Janitor restored | Same fixture's real pre-up hook and Tilt CI complete; public `down --clean` releases the fixture generation, final claims empty, generated snapshots removed, all recorded launch PIDs absent | [public-final.log](public-final.log) |
| Fresh guest at 80f4974 / 9965e0b2 | Green: repeated text/JSON refusals preserve both generated hashes and claims, hook absent; native CI runs hook once; public/repeated clean and invalid-profile case preserve final empty ownership; guest fixture removed | [unedited verdict](guest/verdict-guest.md), [commands](guest/commands.md) |

The public rehearsal used native account discovery in an isolated filesystem
account view with its own `.silo` store, the actual shared Docker engine for
read-only identity/name queries, actual mise, actual Janitor and actual Tilt.
Its sole Tilt resource printed a synthetic message; no Docker/k3d object was
created. Changing HOME alone was not used as account isolation. The exact
commands, statuses and output are in the public record.

Build provenance: the public run recorded bf51f59 plus source diff SHA-256
`56bda1b082238141ab8e0f4863f7a2b0dad2060106aa1658b643d93ef1701fb0` and the CLI
digest above. After commit, `git diff bf51f59 80f4974` over all three changed
source/doc inputs has that identical diff digest. Commit hooks changed none of
those inputs. The later sentinel-only test change leaves product inputs and
the built artifact unchanged; final push hooks run all 130 cases with that
corrected test. Later evidence-only commits reuse this identity.

## Noticed and not checked

The first public setup accidentally left a native Janitor fallback after the
shim on PATH, so mise found it and CI succeeded. It was cleaned publicly. The
second setup isolated PATH but lacked the copied install metadata, yielding
an invalid-shim error; it too was cleaned publicly. Copying the fixture's own
Janitor install metadata reproduced the host's exact no-version error. These
are fixture corrections, not claimed pre-existing product failures. The
initial records and cleanups are retained beside the final run.

The guest noticed that raw mise ANSI escapes remain inside the valid JSON
message. This is recorded as polish; no diagnostic normalization contract is
claimed. The guest did not exercise interruption or Docker/k3d workloads.

The [closing audit](closing-audit.json) observes zero active generations and
claims in the disposable store, absence of all 22 recorded author PID/group
handles and removal of the guest fixture. The guest separately checked its
own returned process groups and recorded native launch handles. Scratch and
task-created dependencies/build output are removed after evidence retention;
the coordinator must restore frozen dependencies for its normal push hooks.

The prior broad Linux allocation/role-removal/append/crash/foreign-resource
evidence remains at its named source and is reused for unchanged allocation
inputs; none is presented as a newly executed full-suite rehearsal here.
Native Mac/APFS/process behavior, the original Mac push failure, hosted CI,
corrected-head specialist approval and final 1.0.0 artifacts are not checked.
The proposal remains draft. No waiver, version bump, host cutover, tag,
release, npm publication or Git network call occurred in this lane.
