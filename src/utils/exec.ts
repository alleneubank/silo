import { withTimeout, observe } from "./timeout";
import { SiloError } from "./errors";

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  context: string;
  stdio?: "inherit" | "pipe";
  signal?: AbortSignal;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const toText = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const chunks: Uint8Array[] = [];
  const limit = 1024 * 1024;
  let size = 0;
  while (size <= limit) {
    const chunk = await reader.read();
    if (chunk.done) return Buffer.concat(chunks).toString("utf8");
    size += chunk.value.byteLength;
    if (size > limit) throw new SiloError("Command output exceeds 1 MiB", "COMMAND_OUTPUT_LIMIT");
    chunks.push(chunk.value);
  }
  throw new Error("Unreachable output limit");
};

export async function runCommand(cmd: string[], options: CommandOptions): Promise<CommandResult> {
  const { cwd, env, timeoutMs, context, stdio = "inherit", signal } = options;
  signal?.throwIfAborted();
  const proc = Bun.spawn(cmd, {
    ...(cwd === undefined ? {} : { cwd }),
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "ignore", stdout: stdio, stderr: stdio,
  });
  const stdout = typeof proc.stdout === "object" ? proc.stdout.getReader() : null;
  const stderr = typeof proc.stderr === "object" ? proc.stderr.getReader() : null;
  const cancel = async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await Promise.all([stdout?.cancel(), stderr?.cancel()]);
    await withTimeout(observe(proc.exited), 1000, `${context} exit after cancellation`);
  };
  const result = Promise.all([stdout ? toText(stdout) : "", stderr ? toText(stderr) : "", proc.exited])
    .then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
  // The command scope owns both its process handle and its output readers.
  try {
    return await withTimeout({ result, cancel }, timeoutMs, context, signal);
  } finally {
    await Promise.all([stdout?.cancel(), stderr?.cancel()]);
    stdout?.releaseLock();
    stderr?.releaseLock();
  }
}
