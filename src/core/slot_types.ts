import { z } from "zod";

/** Bounds decided at design time; exceeding one is an operating error. */
const MAX_SLOT_CAP = 64;
const MAX_SLOT_PORTS = 256;
const MAX_ON_ACQUIRE_STEPS = 32;
export const MAX_RUN_SLOTS = 16;
export const MAX_SLOT_RUNS = 4096;
const MAX_SLOT_ENV = 256;

export const SlotNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, "slot names use lowercase letters, digits and '-'").brand<"SlotName">();
export type SlotName = z.infer<typeof SlotNameSchema>;

const PLACEHOLDER = /\$\{([^}]*)\}/g;

/** `${slot}` is the unit index; `${ports.i}` is the i-th port of the slot's block. */
export const renderSlotValue = (template: string, grant: SlotGrant): string =>
  template.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "slot") return String(grant.unit);
    const index = /^ports\.(\d+)$/.exec(name)?.[1];
    const port = index === undefined ? undefined : grant.ports[Number(index)];
    if (port === undefined) throw new Error(`Unvalidated slot placeholder: ${name}`);
    return String(port);
  });

const SlotConfigObjectSchema = z.object({
  env: z.record(z.string()).refine(env => Object.keys(env).length <= MAX_SLOT_ENV, `at most ${MAX_SLOT_ENV} env entries`).default({}),
  "on-acquire": z.array(z.string().min(1)).max(MAX_ON_ACQUIRE_STEPS).default([]),
  ports: z.number().int().min(0).max(MAX_SLOT_PORTS).default(0),
}).strict();

const SlotConfigSchema = SlotConfigObjectSchema.superRefine((slot, context) => {
  for (const [key, template] of Object.entries(slot.env)) {
    for (const [, name] of template.matchAll(PLACEHOLDER)) {
      const index = /^ports\.(\d+)$/.exec(name ?? "")?.[1];
      const valid = name === "slot" || (index !== undefined && Number(index) < slot.ports);
      if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path: ["env", key], message: `unknown placeholder \${${name}}; use \${slot} or \${ports.0}..\${ports.${Math.max(slot.ports - 1, 0)}} (ports = ${slot.ports})` });
    }
  }
});
export type SlotConfig = z.infer<typeof SlotConfigSchema>;

export const SlotsConfigSchema = z.record(z.string(), SlotConfigSchema).superRefine((slots, context) => {
  for (const name of Object.keys(slots)) {
    if (!SlotNameSchema.safeParse(name).success) context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: "slot names use lowercase letters, digits and '-'" });
  }
});

/** `<account home>/.silo/host.toml`: the host operator's caps. No entry means unavailable. */
export const HostConfigSchema = z.object({
  slots: z.record(z.string(), z.number().int().min(1).max(MAX_SLOT_CAP)).default({}),
}).strict();
export type HostCaps = ReadonlyMap<SlotName, number>;

/** One process recorded by a run: its PID and the `ps` start identity observed for it. */
const RecordedProcessSchema = z.object({ pid: z.number().int().min(2), identity: z.string().min(1) });

const SlotRequestSchema = z.object({ slot: SlotNameSchema, ports: z.number().int().min(0).max(MAX_SLOT_PORTS) });
export type SlotRequest = z.infer<typeof SlotRequestSchema>;

const SlotGrantSchema = z.object({
  slot: SlotNameSchema, unit: z.number().int().min(0).max(MAX_SLOT_CAP - 1),
  ports: z.array(z.number().int().min(1).max(65535)).max(MAX_SLOT_PORTS),
});
export type SlotGrant = z.infer<typeof SlotGrantSchema>;

/** The executor group a held run launched: Janitor's supervisor and its gated group leader. */
const SlotLaunchSchema = z.object({
  supervisor: RecordedProcessSchema,
  leaderPid: z.number().int().min(2), groupId: z.number().int().min(2),
});
export type SlotLaunch = z.infer<typeof SlotLaunchSchema>;

const SlotRunBaseSchema = z.object({
  id: z.string().uuid(), root: z.string().min(1).max(4096),
  command: z.array(z.string()).min(1).max(1024),
  requests: z.array(SlotRequestSchema).min(1).max(MAX_RUN_SLOTS),
  waiter: RecordedProcessSchema, enqueuedAt: z.string(),
});

/** A waiting run holds nothing; a held run owns its units and port blocks until released. */
export const SlotRunSchema = z.discriminatedUnion("phase", [
  SlotRunBaseSchema.extend({ phase: z.literal("waiting") }),
  SlotRunBaseSchema.extend({
    phase: z.literal("held"), grants: z.array(SlotGrantSchema).min(1).max(MAX_RUN_SLOTS),
    grantedAt: z.string(), launch: SlotLaunchSchema.nullable(),
  }),
]);
export type SlotRun = z.infer<typeof SlotRunSchema>;
export type HeldSlotRun = Extract<SlotRun, { phase: "held" }>;

/** Written once by the gated executor; `failedStep` names the on-acquire step that stopped the run. */
export const SlotCompletionSchema = z.object({
  runId: z.string().uuid(), leaderPid: z.number().int().min(2), groupId: z.number().int().min(2),
  started: z.boolean(), exitCode: z.number().int(), failedStep: z.number().int().min(0).nullable(), completedAt: z.string(),
});
export type SlotCompletion = z.infer<typeof SlotCompletionSchema>;

/** What the gated executor of a run without slots receives once its group is verified. */
export const RunExecutorGrantSchema = z.object({
  runId: z.string().uuid(), leaderPid: z.number().int().min(2), groupId: z.number().int().min(2),
  command: z.array(z.string()).min(1).max(1024),
});
export type RunExecutorGrant = z.infer<typeof RunExecutorGrantSchema>;

/** What the gated executor receives once its group is durably recorded as the holder. */
export const SlotExecutorGrantSchema = RunExecutorGrantSchema.extend({
  onAcquire: z.array(z.string().min(1)).max(MAX_ON_ACQUIRE_STEPS),
});
export type SlotExecutorGrant = z.infer<typeof SlotExecutorGrantSchema>;
