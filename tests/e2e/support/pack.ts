import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../helpers/cli.js";

/** What scripts/pack-install.mjs prints: a real `npm pack` tarball installed into a fresh directory outside the repository. */
export interface PackInfo {
  out: string;
  tarball: string;
  filename: string;
  sha256: string;
  bytes: number;
  version: string;
  files: string[];
  consumer: string;
  packageDir: string;
  bin: string;
}

/** Path to a JSON file with a PackInfo. Set by the global setup so every worker shares one tarball and one install. */
export const PACK_ENV = "PROOFGATE_E2E_INFO";

/**
 * Reuse the install named by PROOFGATE_E2E_INFO, or build, pack and install a new one.
 * Set PROOFGATE_E2E_KEEP=1 to keep the temporary directory for inspection.
 */
export function ensurePack(): { info: PackInfo; dispose(): void } {
  const existing = process.env[PACK_ENV];
  if (existing !== undefined && existing !== "") {
    return { info: JSON.parse(readFileSync(existing, "utf8")) as PackInfo, dispose: () => undefined };
  }
  const stdout = execFileSync(process.execPath, [join(ROOT, "scripts", "pack-install.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const info = JSON.parse(stdout) as PackInfo;
  const file = join(info.out, "pack.json");
  writeFileSync(file, stdout);
  process.env[PACK_ENV] = file;
  return {
    info,
    dispose() {
      delete process.env[PACK_ENV];
      if (process.env.PROOFGATE_E2E_KEEP !== "1") rmSync(info.out, { recursive: true, force: true });
    },
  };
}

export function readPackInfo(): PackInfo {
  const file = process.env[PACK_ENV];
  if (file === undefined || file === "") throw new Error(`${PACK_ENV} is not set; run through the e2e global setup`);
  return JSON.parse(readFileSync(file, "utf8")) as PackInfo;
}
