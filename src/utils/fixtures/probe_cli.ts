import { runCommand } from "../exec";
import { OperationInterrupts } from "../interrupt";
import { SiloError } from "../errors";

const [tool, mode] = Bun.argv.slice(2);
if (!tool || !mode) throw new Error("Expected probe path and mode");
const scope = new OperationInterrupts("up");
try {
  await scope.run(async () => {
    // A local observation deadline must not hide the command's interrupt.
    const local = new AbortController();
    const result = await runCommand([tool, mode], { timeoutMs: 10_000, context: "probe", stdio: "pipe", ...(mode === "ambient" ? {} : { signal: local.signal }) });
    console.log(JSON.stringify(result));
  });
} catch (error) {
  console.log(JSON.stringify({ code: error instanceof SiloError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = error instanceof SiloError && error.code === "INTERRUPTED" ? 130 : 1;
} finally { scope.close(); }
