import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build dist/ once so the subprocess CLI tests exercise the packaged executable. */
export default function setup(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });
}
