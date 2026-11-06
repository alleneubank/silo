import { withTimeout } from "./timeout";
import { SiloError } from "./errors";

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  context: string;
  stdio?: "inherit" | "pipe";
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const toText = async (
  stream: ReadableStream | null | undefined
): Promise<string> => {
  if (!stream) {
    return "";
  }
  const reader = stream.getReader();
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

export async function runCommand(
  cmd: string[],
  options: CommandOptions
): Promise<CommandResult> {
  const { cwd, env, timeoutMs, context, stdio = "inherit" } = options;
  const spawnOptions: Parameters<typeof Bun.spawn>[1] = {
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "ignore",
    stdout: stdio,
    stderr: stdio,
  };
  if (cwd) {
    spawnOptions.cwd = cwd;
  }

  const proc = Bun.spawn(cmd, spawnOptions);

  try {
    if (stdio === "inherit") {
      const exitCode = await withTimeout(proc.exited, timeoutMs, context);
      return { exitCode, stdout: "", stderr: "" };
    }

    const resultPromise = (async () => {
      const stdoutStream = proc.stdout as ReadableStream | null | undefined;
      const stderrStream = proc.stderr as ReadableStream | null | undefined;
      const [stdout, stderr, exitCode] = await Promise.all([
        toText(stdoutStream),
        toText(stderrStream),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    })();

    return await withTimeout(resultPromise, timeoutMs, context);
  } catch (error) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
    throw error;
  }
}
