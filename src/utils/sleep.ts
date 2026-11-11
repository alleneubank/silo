import { setTimeout } from "node:timers/promises";

export const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  try { await setTimeout(ms, undefined, signal === undefined ? {} : { signal }); }
  catch (error) { signal?.throwIfAborted(); throw error; }
};
