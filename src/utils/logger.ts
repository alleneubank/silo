import type { PortAllocationEvent } from "../core/ports";

type LogFn = (...args: Array<string | number | boolean | object>) => void;

const formatPrefix = (level: string) => `silo ${level}:`;

let verboseEnabled = false;
let structuredOutput = false;

export const setStructuredOutput = (enabled: boolean): void => { structuredOutput = enabled; };

export const setVerbose = (enabled: boolean): void => {
  verboseEnabled = enabled;
};

export const logger = {
  info: ((...args) => (structuredOutput ? console.error : console.log)(formatPrefix("info"), ...args)) as LogFn,
  warn: ((...args) => console.warn(formatPrefix("warn"), ...args)) as LogFn,
  error: ((...args) => console.error(formatPrefix("error"), ...args)) as LogFn,
  // Progress that must never mix with a command's stdout or a JSON result.
  progress: ((...args) => console.error(formatPrefix("info"), ...args)) as LogFn,
  verbose: ((...args) => {
    if (verboseEnabled) {
      (structuredOutput ? console.error : console.log)(formatPrefix("verbose"), ...args);
    }
  }) as LogFn,
};

export const logPortAllocations = (events: PortAllocationEvent[]): void => {
  events.forEach((event) => {
    if (event.source === "fallback") {
      if (event.requestedDefault !== "random") {
        logger.warn(
          `Port ${event.key} unavailable (${event.requestedDefault} is in use, claimed or inside the kernel ephemeral range), allocated ${event.assigned}`
        );
        logger.verbose(`Port ${event.key} source: ${event.source}`);
        return;
      }
      logger.verbose(
        `Port ${event.key} allocated outside the kernel ephemeral range (${event.assigned})`
      );
      logger.verbose(`Port ${event.key} source: ${event.source}`);
      return;
    }
    logger.verbose(`Port ${event.key} source: ${event.source} (${event.assigned})`);
  });
};

/** Prints a labelled block of `  key: value` lines, or nothing when empty. */
export const logKeyValues = (
  label: string,
  entries: Record<string, string | number>
): void => {
  const rows = Object.entries(entries);
  if (rows.length === 0) {
    return;
  }
  logger.info(`${label}:`);
  rows.forEach(([key, value]) => {
    logger.info(`  ${key}: ${value}`);
  });
};
