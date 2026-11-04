import { z } from "zod";
import { InstanceStateSchema } from "./lease_types";
import type { ProjectOperation } from "./lease_store";

export const LockfileSchema = z.object({
  version: z.literal(2), projectId: z.string(), generation: z.number().int().positive(),
  generatedAt: z.string(), instance: InstanceStateSchema,
});

/** Lockfiles are exported consumer snapshots, never allocation or deletion authority. */
export const writeLockfile = (owner: ProjectOperation): void => {
  const current = owner.current();
  if (!current) throw new Error("Cannot export an unallocated project");
  owner.file("lock").publish(JSON.stringify(LockfileSchema.parse({
    version: 2, projectId: owner.projectId, generation: owner.generation,
    generatedAt: current.allocation.state.createdAt, instance: current.allocation.state,
  }), null, 2) + "\n");
};
