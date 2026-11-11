import { setTimeout } from "node:timers/promises";
import { operationSignal } from "./interrupt";

export const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  const cancellation = operationSignal(signal);
  try { await setTimeout(ms, undefined, cancellation === undefined ? {} : { signal: cancellation }); }
  catch (error) { cancellation?.throwIfAborted(); throw error; }
};
