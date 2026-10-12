#!/usr/bin/env node
import { cleanupTempPathsSync } from "./fsguard.js";
import { redactString } from "./redact.js";
import { main } from "./run.js";
import { neutralize as t } from "./terminal.js";

/**
 * The executable. Importing this module RUNS the command, always: there is no "am I the entry point" test that could decide
 * wrongly. A test or an embedder imports `main` from `./run.js` instead. Whatever happens, the process must not exit 0
 * without having evaluated: `main` returns the exit code and it is the only thing that sets it.
 */

/** Last-resort handler: a stable one-line internal error on stderr (no stack trace), exit 2. */
function reportCrash(error: Error): void {
  try {
    process.stderr.write(`${t(redactString(`proofgate: error [internal_error]: unexpected failure: ${error.message ?? String(error)}`))}\n`);
  } catch {
    // stderr is gone too; there is nothing left to say.
  }
  cleanupTempPathsSync();
  process.exit(2);
}

// An interrupted run must not leave a half-written report or bundle behind: remove the temporary output that is still
// in flight, then exit with the conventional signal status. (A finished output is never touched.)
for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    cleanupTempPathsSync();
    process.exit(status);
  });
}
// A closed stdout (`proofgate evaluate ... | head -1`) is not a failure of the evaluation: the verdict is still the exit
// code, so an EPIPE must never turn into the "policy unsatisfied" status 1 by way of an uncaught exception.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") return;
  reportCrash(error);
});
process.stderr.on("error", () => undefined);
// Anything that escapes main() is an internal error (exit 2), never exit 1: 1 means "the policy is unsatisfied".
process.on("uncaughtException", reportCrash);
process.on("unhandledRejection", (reason) => reportCrash(reason instanceof Error ? reason : new Error(String(reason))));
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
