# Decision-only operator response

No lifecycle or configuration commands were executed. Commands below are proposed operator steps.

Before configuration or repair, run `silo doc --list`, then `silo doc profiles`, `silo doc ports`, `silo doc lockfile`, `silo doc k3d`, and `silo doc troubleshooting`; inspect `silo help env`, `silo help up`, and `silo help down` for the installed build.

1. **Run alternative alongside A, preserving A's endpoint.** In `/owned/a`, read `silo status --json` and record its name, profile, ports, and generated endpoint. Leave that live allocation running. Provision a separate physical project root, for example `/owned/a-alternative`, with the needed project configuration and profile, without copying A's generated env/lock/kubeconfig. In that root run `silo env a-alternative --profile alternative`, inspect `silo status --json`, then run `silo up a-alternative --profile alternative`. Use a unique name and distinct generated file targets. Read A's status again to confirm its original endpoint assignment remains. Drive each stack's resource health using its own generated env and `tilt get uiresources --port "$TILT_PORT"`. Profiles, changed HOME, or SILO_PORT_REGISTRY_DIR do not create separate allocation domains. Do not force-reconfigure A to obtain parallelism.

2. **Later switch A itself with authorized cluster deletion and cleanup.** In `/owned/a`, run `silo status --json` and confirm A's exact ownership. The authorization covers deletion of A's ephemeral cluster and cleanup only. Run `silo down --delete-cluster --clean`, then inspect `silo status --json` and require successful retirement before proceeding. If cleanup is uncertain or fails, retain claims and use the reported facts/troubleshooting; do not delete B's objects, locks, reservations, or store records. After successful clean, run `silo up <A-original-name> --profile alternative` in A's root. This creates its replacement allocation; preserving the old endpoint was required for task 1, and is not promised across clean/reallocation. If cleanup were not requested, the supported switch would instead explicitly delete the retained owned cluster, reconcile, and then use `silo up <A-original-name> --profile alternative --force`; force cannot bypass retention or uncertainty.

3. **LEGACY_STATE listing `/owned/old` and `/owned/peer`.** Stop new allocations and preserve the listing; a lock-only peer also blocks. Announce the host cutover and coordinate both owners. During the pre-cutover drain, the old project's owner uses its own old Silo, after checking that version's help, to stop and retire its own ephemeral environment and legacy allocation through its supported lifecycle. The peer's owner must independently do the same for `/owned/peer`; this operator has no authority to touch that data. Retire or upgrade every permitted old invocation and wait for all old operations, including paused operations, to become terminal before the clean scan and first new allocation. No old clients may run after cutover. Re-run the new client's requested `env` only once every listed owner has completed retirement and the host cutover is ready; each owner then recreates its own environment. If the peer owner is unavailable, the new allocation remains blocked. Do not edit/delete a JSON entry or lock, change HOME, or relocate the store to evade the refusal. New-client `down` also refuses LEGACY_STATE and cannot perform the old owner's retirement.

4. **Stopped, reconciled lock-only project changes declared ports.** In that project's root, inspect `silo status --json` to confirm stopped/reconciled state and absence of retained resources or uncertain work. Update the intended port declarations in its configuration, then run `silo env <stored-name> --force` with the intended profile explicitly selected if needed. Inspect `silo status --json` and the generated consumer env for the new declared assignments. Force is legitimate here; lock-only claims alone do not require deleting a cluster, retiring the generation, or blanket refusal of force. If status instead shows live, retained, or uncertain state, reconcile that condition before force. This path starts no stack.

# Effective instruction sources read

- Parent's bounded evaluation assignment and supplied conversation AGENTS.md instructions, with the frozen task's read-only scope governing this decision exercise.
- `/home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl-tmp/skill-eval/task.md`.
- `/home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl-tmp/skill-eval/candidate/SKILL.md` (supplied Silo skill).
- Product documents read: `docs/commands.md`, `docs/profiles.md`, `docs/troubleshooting.md`, `docs/lockfile.md`, `docs/ports.md`, and `docs/k3d.md` in the named project.

# Actual command sequence

1. `cat <evaluation-root>/task.md <evaluation-root>/candidate/SKILL.md`
2. `rg --files docs -g '*silo*' -g '*profile*' -g '*port*' -g '*trouble*' -g '*lock*'; rg --files docs`
3. `cat docs/commands.md docs/profiles.md docs/troubleshooting.md docs/lockfile.md docs/ports.md docs/k3d.md`
4. Write this assigned result file using a quoted heredoc.

No source, diffs, history, author sessions, or other variant were read. The only write was this required output artifact. No proposed operator flow was executed or verified against a running Silo build.
