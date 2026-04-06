import { revertEnvFile } from "../env-patch.js";
import { printError } from "./runner.js";

interface EnvFlags {
  json?: boolean;
  quiet?: boolean;
}

export async function runEnv(
  subcommand: string | undefined,
  positional: string | undefined,
  flags: EnvFlags,
): Promise<void> {
  const isJSON = !!flags.json;
  const isQuiet = !!flags.quiet;

  if (subcommand !== "revert") {
    const msg = "Usage: sow env revert [path]";
    if (isJSON) console.log(JSON.stringify({ type: "error", message: msg }));
    else printError(msg);
    process.exit(1);
  }

  const path = positional || ".env.local";
  try {
    await revertEnvFile(path);
    if (isJSON) {
      console.log(JSON.stringify({ type: "result", reverted: path }));
    } else if (isQuiet) {
      console.log(`reverted: ${path}`);
    } else {
      console.log(`  ✓ Reverted ${path} from backup`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isJSON) console.log(JSON.stringify({ type: "error", message: msg }));
    else printError(msg);
    process.exit(1);
  }
}
