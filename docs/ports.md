# Port allocation and account ownership

Run `silo doc ports` for this reference.

A new generation tries configured defaults in declaration order, then scans
49152–65535. `random` or `0` skips the default. Duplicate defaults fall back
independently. Ports are scalar host-wide claims: TCP, UDP, IPv4 and IPv6 use
the same number domain. Native binds are availability hints, not reservations.
A non-silo process can win a later bind; silo fails rather than renumbering an
exported generation, killing the listener, or treating its response as success.

All ports, final resource names, overlapping Docker namespace prefixes, and
physical file targets commit together under SQLite `BEGIN IMMEDIATE`. A unique
`(domain, resource)` key belongs to a project and generation. A losing allocator
retries port selection; a name/path conflict refuses. Lock-only allocations
reserve ports even when nothing listens. Existing generations retain their
ports without probing them into a different assignment.

The authoritative store is `<account-home>/.silo/leases.sqlite`, where
account-home comes from the operating-system account record. Scrubbed `HOME`,
worktrees, profiles and changed `SILO_PORT_REGISTRY_DIR` values share this
allocation domain. There is no public store-location override. A local Unix
Docker endpoint and a stable engine ID are required. Separate accounts,
machines and remote engines are outside this domain's guarantee.

Peer reads never release, rewrite or expire reservations. No TTL, missing
lockfile, dead PID or empty backend listing independently authorizes reuse.
`down --clean` releases only its own generation after terminal command groups,
completed requests, absent owned backend resources and no remaining TCP or UDP
listener on a declared port are proved. Another process's outgoing connection
that happens to use a declared port as its local port does not block it.
Retained resources and uncertain outcomes keep claims.

On Linux this proof reads `/proc/net/{tcp,udp,tcp6,udp6}` in silo's network
namespace. TCP LISTEN and peerless UDP sockets on any address block cleanup;
connected sockets and TIME-WAIT do not. Every nonempty row must have valid
required fields, endpoints and state. Missing IPv4 tables always refuse.
Missing IPv6 tables refuse unless both are missing and `/proc/sys/net/ipv6`
is independently absent, establishing that the kernel exposes no IPv6 support.
An existing sysctl directory, including configurations with IPv6 disabled on
some interfaces, does not excuse a missing table.

On macOS this proof reads the native `/usr/sbin/lsof` TCP/UDP listing, using
numeric endpoints and NUL-delimited machine fields. TCP LISTEN and UDP sockets
without a peer block cleanup on loopback, wildcard and non-loopback addresses,
for both address families. Connected TCP/UDP sockets do not block it.
The guarantee covers sockets visible to this OS account; other accounts are
outside the allocation domain. A successful nonempty listing is required.
Cleanup observes each declared port once, serially, with a maximum of
`SOCKET_TABLE_TIMEOUT_MS` (30,000 ms) per observation. Execution errors,
warnings, missing fields, unknown states, malformed or incomplete output,
output over 1 MiB, and an observation that does not finish within that bound
refuse cleanup and replacement before ownership is released. Linux observations
use the same size and time bounds. A single missing IPv6 table refuses; both
missing IPv6 tables also refuse when `/proc/sys/net/ipv6` exists or cannot be
observed. Both missing tables are accepted when that sysctl directory is absent,
indicating a kernel without IPv6. Unsupported platforms refuse the proof. A
successful empty macOS listing refuses the proof as well.

Neither observation reserves the port or prevents a socket appearing after
the observation. Candidate allocation still uses native TCP/UDP binds and
therefore excludes connected sockets that would conflict with a service bind.

`--force` reconfigures only a stopped, reconciled generation. It cannot disown
a live stack. Parallel stacks require separate roots and names.

## Legacy cutover

Before the first new allocation on a host, announce the cutover, upgrade or
retire every permitted old silo invocation, and wait until all old operations
are terminal. Then each owner stops and recreates its ephemeral projects.
There is no migrate command, JSON import, or automatic old-client detector.
An old command paused before publication must finish before the clean scan.

`env`, `up`, `ci`, `down` and `status` first inspect all `*.json` entries in
`SILO_PORT_REGISTRY_DIR`, the account-home `.silo/instances`, and the invoking
HOME's `.silo/instances`, plus the selected root's legacy `.silo.lock`.
Any entry—including malformed, stale or lock-only state—returns `LEGACY_STATE`
with a listing and changes nothing. Those directories are never created or
edited by the new allocator. A version-2 snapshot carrying project/generation
markers is not a legacy lock. Old clients run after cutover are unsupported;
the next visible legacy entry blocks new commands but cannot undo an earlier
old-client allocation.
