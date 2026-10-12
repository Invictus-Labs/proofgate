import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Is the module at `metaUrl` the script node was started with? Node finds its entry the way `require` does: a file as
 * written, the same with `.js` added, or a directory (through the `main` of its `package.json`, else `index.js`). So
 * `node .`, `node dist`, `node dist/index` and `node dist/index.js` can all start the same file, and each one must be
 * recognised, or a module that is not the command would start, do nothing and exit 0. The comparison is on real paths, so a
 * symlink to the file is recognised too. Anything that cannot be resolved is "not the entry point" (a `-e` script, a REPL).
 */
export function isStartedAsMain(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (argv1 === undefined || argv1 === "") return false;
  try {
    const self = realpathSync(fileURLToPath(metaUrl));
    const started = createRequire(metaUrl).resolve(resolve(argv1));
    return realpathSync(started) === self;
  } catch {
    return false;
  }
}

/**
 * The library modules (`dist/index.js`, `dist/run.js`) must never be the entry point: they define the commands but do not run
 * them, so `node dist/index.js evaluate ...` used to print nothing and exit 0 even on a failing tree. Started as the main
 * script they say so and exit 2; imported (by the command, by a test, by another program) they do nothing at all.
 */
export function refuseWhenStartedAsMain(metaUrl: string, module: string): void {
  if (!isStartedAsMain(metaUrl)) return;
  process.stderr.write(`proofgate: error [cli_usage]: ${module} is a library module, not the command; run the proofgate command (or node dist/cli.js) instead\n`);
  process.exit(2);
}
