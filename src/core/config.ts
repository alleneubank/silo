import path from "path";
import { z } from "zod";
import {
  CONFIG_VERSION,
  DEFAULT_HOSTS,
  DEFAULT_OUTPUT,
  DEFAULT_PREFIX,
  DEFAULT_URLS,
} from "./constants";
import type { LifecycleHooks, ResolvedConfig, SiloConfig } from "./types";
import { SiloError } from "../utils/errors";

const PortValueSchema = z.preprocess(
  (value) => (value === 0 ? "random" : value),
  z.union([z.number().int().min(1).max(65535), z.literal("random")])
);

const PortsSchema = z
  .record(PortValueSchema)
  .refine((ports) => Object.keys(ports).length > 0, {
    message: "ports must define at least one entry",
  });

const HooksSchema = z
  .object({
    "pre-up": z.array(z.string()).optional(),
    "post-up": z.array(z.string()).optional(),
    "pre-down": z.array(z.string()).optional(),
    "post-down": z.array(z.string()).optional(),
  })
  .strict();

const RegistryAdvertiseSchema = z
  .object({
    advertise: z.boolean().optional(),
    host: z.string().optional(),
    hostFromContainerRuntime: z.string().optional(),
    hostFromClusterNetwork: z.string().optional(),
    help: z.string().optional(),
  })
  .strict();

const K3dRegistrySchema = RegistryAdvertiseSchema.extend({
  enabled: z.boolean(),
}).strict();

const ProfileK3dRegistrySchema = RegistryAdvertiseSchema.extend({
  enabled: z.boolean().optional(),
}).strict();

// Literal POSIX-style file paths keep kubeconfig inside the project and avoid
// shell expansion or KUBECONFIG's platform-dependent path-list separators.
const ProjectRelativePathSchema = z.string().max(4096).refine(
  (value) =>
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !path.posix.isAbsolute(value) &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
  { message: "kubeconfigPath must be a project-relative file path without traversal or expansion" }
).brand<"ProjectRelativePath">();

const TiltSchema = z.object({ webMode: z.literal("prod").optional() }).strict();

const K3dSchema = z
  .object({
    enabled: z.boolean(),
    kubeconfigPath: ProjectRelativePathSchema.optional(),
    args: z.array(z.string()).optional(),
    registry: K3dRegistrySchema.optional(),
  })
  .strict();

const ProfileK3dSchema = z
  .object({
    enabled: z.boolean().optional(),
    kubeconfigPath: ProjectRelativePathSchema.optional(),
    args: z.array(z.string()).optional(),
    registry: ProfileK3dRegistrySchema.optional(),
  })
  .strict();

const ProfileAppendSchema = z
  .object({
    hooks: HooksSchema.optional(),
    k3d: z
      .object({
        args: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ProfileConfigSchema = z
  .object({
    ports: PortsSchema.optional(),
    hosts: z.record(z.string()).optional(),
    urls: z.record(z.string()).optional(),
    k3d: ProfileK3dSchema.optional(),
    tilt: TiltSchema.optional(),
    hooks: HooksSchema.optional(),
    append: ProfileAppendSchema.optional(),
    registry: RegistryAdvertiseSchema.optional(),
  })
  .strict();

const SiloConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    prefix: z.string().optional(),
    output: z.string().optional(),
    ports: PortsSchema,
    hosts: z.record(z.string()).optional(),
    urls: z.record(z.string()).optional(),
    k3d: K3dSchema.optional(),
    tilt: TiltSchema.optional(),
    hooks: HooksSchema.optional(),
    profiles: z.record(ProfileConfigSchema).optional(),
    registry: RegistryAdvertiseSchema.optional(),
  })
  .strict();

const ensureAppHost = (hosts: Record<string, string>): void => {
  if (!hosts.APP_HOST) {
    throw new SiloError("hosts must include APP_HOST", "INVALID_CONFIG");
  }
};

export const loadConfig = async (configPath: string): Promise<ResolvedConfig> => {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const configFile = Bun.file(resolvedPath);
  if (!(await configFile.exists())) {
    throw new SiloError(`Config file not found: ${resolvedPath}`, "CONFIG_NOT_FOUND");
  }

  const rawText = await configFile.text();
  const rawParsed = Bun.TOML.parse(rawText) as unknown;
  if (!rawParsed || typeof rawParsed !== "object") {
    throw new SiloError("Config file did not parse to an object", "INVALID_CONFIG");
  }

  const parsed = SiloConfigSchema.parse(rawParsed) as SiloConfig;
  const ports = parsed.ports;
  const portOrder = Object.keys(ports);

  const hosts = parsed.hosts ? { ...parsed.hosts } : { ...DEFAULT_HOSTS };
  ensureAppHost(hosts);
  const hostOrder = Object.keys(hosts);

  const urls = parsed.urls ? { ...parsed.urls } : { ...DEFAULT_URLS };
  const urlOrder = Object.keys(urls);

  const hooks: LifecycleHooks = parsed.hooks ?? {};

  const configDir = path.dirname(resolvedPath);

  return {
    version: CONFIG_VERSION,
    prefix: parsed.prefix ?? DEFAULT_PREFIX,
    output: parsed.output ?? DEFAULT_OUTPUT,
    ports,
    portOrder,
    hosts,
    hostOrder,
    urls,
    urlOrder,
    k3d: parsed.k3d,
    tilt: parsed.tilt,
    hooks,
    profiles: parsed.profiles,
    registry: parsed.registry,
    configPath: resolvedPath,
    projectRoot: configDir,
  };
};
