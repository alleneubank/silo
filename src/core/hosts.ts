import { interpolateTemplate } from "./interpolate";
import type { IdentityVars } from "./types";
import { SiloError } from "../utils/errors";

export const resolveHosts = (params: {
  templates: Record<string, string>;
  order: string[];
  identityVars: IdentityVars;
}): { hosts: Record<string, string>; order: string[] } => {
  const { templates, order, identityVars } = params;
  const resolved: Record<string, string> = {};

  order.forEach((key) => {
    const template = templates[key];
    if (template === undefined) {
      throw new SiloError(`Host template missing for key: ${key}`, "INVALID_CONFIG");
    }
    resolved[key] = interpolateTemplate(template, identityVars);
  });

  if (!resolved.APP_HOST) {
    throw new SiloError("APP_HOST must be defined in hosts", "INVALID_CONFIG");
  }

  resolved.TILT_HOST ??= resolved.APP_HOST;
  const nextOrder = order.includes("TILT_HOST")
    ? order
    : [...order, "TILT_HOST"];

  return { hosts: resolved, order: nextOrder };
};
