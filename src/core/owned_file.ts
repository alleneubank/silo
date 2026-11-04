import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync,
  writeFileSync, writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SiloError } from "../utils/errors";
import { digest, type FileAuthority, type ProjectOperation } from "./lease_store";
import { fileIdentity, verifyFileParent } from "./file_target";
import type { FileReceipt } from "./lease_types";

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

const hashFile = (file: string): string => {
  if (lstatSync(file).size > MAX_SNAPSHOT_BYTES) throw new SiloError(`PATH_CHANGED: oversized snapshot: ${file}`, "PATH_CHANGED");
  return digest(readFileSync(file));
};

const synchronizeParent = (parent: string): void => {
  const fd = openSync(parent, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
};

const matches = (file: string, expected: NonNullable<FileReceipt["published"]> | null): boolean => {
  const identity = fileIdentity(file);
  return expected === null ? identity === null : identity === expected.identity && hashFile(file) === expected.hash;
};

/** A receipt-bound snapshot. Paths come only from this operation's committed allocation. */
export class OwnedFile {
  constructor(
    private readonly owner: FileAuthority,
  ) {}

  private receipt(): FileReceipt {
    this.owner.assertCurrent();
    const receipt = this.owner.receipt();
    verifyFileParent(receipt.target);
    return receipt;
  }

  get path(): string { return this.receipt().target.path; }

  verify(): void {
    const receipt = this.receipt();
    if (receipt.pending) throw new SiloError(`INCOMPLETE_EXPORT: ${receipt.target.path}; resume this owner's export before reallocating`, "INCOMPLETE_EXPORT");
    if (!matches(receipt.target.path, receipt.published)) {
      throw new SiloError(`PATH_CHANGED: snapshot no longer matches its receipt: ${receipt.target.path}. Claims retained; inspect the replacement's owner.`, "PATH_CHANGED");
    }
  }

  /** Completes only the recorded rename/unlink, never an unrecognized replacement. */
  recover(): void {
    const receipt = this.receipt();
    const pending = receipt.pending;
    if (!pending) { this.verify(); return; }
    if (pending.action === "publish") {
      this.owner.assertPublishing();
      const expected = { identity: pending.identity, hash: pending.hash, generation: this.owner.generation };
      if (!matches(receipt.target.path, expected)) {
        if (!matches(receipt.target.path, receipt.published) || !matches(pending.temporary, expected)) {
          throw new SiloError(`PATH_CHANGED: incomplete export has an unexpected target or temporary file: ${receipt.target.path}`, "PATH_CHANGED");
        }
        renameSync(pending.temporary, receipt.target.path);
      }
      synchronizeParent(receipt.target.parent);
      this.owner.checkpoint({ ...receipt, published: expected, pending: null });
    } else {
      this.owner.assertRemoving();
      if (fileIdentity(receipt.target.path) !== null) {
        if (!matches(receipt.target.path, receipt.published)) {
          throw new SiloError(`PATH_CHANGED: pending cleanup found a replacement: ${receipt.target.path}`, "PATH_CHANGED");
        }
        unlinkSync(receipt.target.path);
      }
      synchronizeParent(receipt.target.parent);
      this.owner.checkpoint({ ...receipt, published: null, pending: null });
    }
  }

  publish(content: string): void {
    this.owner.assertPublishing();
    if (Buffer.byteLength(content) > MAX_SNAPSHOT_BYTES) throw new SiloError("Snapshot exceeds 1 MiB", "SNAPSHOT_TOO_LARGE");
    this.recover();
    const receipt = this.receipt();
    const hash = digest(content);
    if (receipt.published?.hash === hash && receipt.published.generation === this.owner.generation) return;
    const temporary = path.join(receipt.target.parent, `.silo-${this.owner.projectId}-${randomUUID()}.tmp`);
    const fd = openSync(temporary, "wx", 0o600);
    let checkpointed = false;
    try {
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
      const identity = fileIdentity(temporary)!;
      this.verify();
      this.owner.checkpoint({ ...receipt, pending: { action: "publish", temporary, identity, hash } });
      checkpointed = true;
    } finally {
      closeSync(fd);
      if (!checkpointed) unlinkSync(temporary);
    }
    this.recover();
  }

  remove(): void {
    this.owner.assertRemoving();
    this.recover();
    const receipt = this.receipt();
    if (receipt.published === null) return;
    this.owner.checkpoint({ ...receipt, pending: { action: "delete" } });
    this.recover();
  }
}

/** CI sinks authorize append only. An interrupted append keeps an uncertainty receipt. */
export const appendSink = (owner: ProjectOperation, file: string, content: string): void => {
  if (Buffer.byteLength(content) > MAX_SNAPSHOT_BYTES) throw new SiloError("CI export exceeds 1 MiB", "SNAPSHOT_TOO_LARGE");
  const resolved = path.resolve(file);
  const target = owner.prepareTarget(path.dirname(resolved), path.basename(resolved), "sink");
  verifyFileParent(target);
  const before = fileIdentity(target.path);
  owner.claimSink(target);
  const fd = openSync(target.path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    owner.assertCurrent();
    verifyFileParent(target);
    const stat = fstatSync(fd, { bigint: true });
    const identity = `${stat.dev}/${stat.ino}`;
    if (!stat.isFile() || stat.nlink !== 1n || fileIdentity(target.path) !== identity || (before !== null && identity !== before)) {
      throw new SiloError("PATH_CHANGED: CI sink was replaced", "PATH_CHANGED");
    }
    const written = writeSync(fd, content, undefined, "utf8");
    if (written !== Buffer.byteLength(content)) {
      throw new SiloError(`INCOMPLETE_EXPORT: CI append wrote ${written} of ${Buffer.byteLength(content)} bytes; sink ownership remains uncertain: ${target.path}. Inspect the runner file before any further export.`, "INCOMPLETE_EXPORT");
    }
    fsyncSync(fd);
    if (fileIdentity(target.path) !== identity) throw new SiloError("PATH_CHANGED: CI sink changed during append", "PATH_CHANGED");
  } finally { closeSync(fd); }
  owner.completeSink(target);
};
