// Run a command with a wall-clock cap: node scripts/run-with-cap.mjs <minutes> <command> [args...]
//
// Output is passed through unchanged and the command's exit status is the exit status of this script. When the cap is hit the whole
// process group is killed (SIGKILL) and the status is 124, with a line on stderr. The quality gate runs its test step through this: a
// test that spins in a synchronous loop cannot time out from inside its own process (a timer never fires on a blocked event loop), and
// a gate that waits for it for ever is a gate that a hang passes by never finishing.
//
// The command runs in its own process group so that the cap can kill everything it started. So that interrupting this wrapper (Ctrl-C,
// `kill`, a closed terminal) does not leave that group running as an orphan, SIGINT, SIGTERM and SIGHUP are forwarded to the group, the
// group gets a few seconds to end, then it is killed, and the status is 128 plus the signal number. A cap above what a timer can hold
// (2^31 - 1 milliseconds, about 24.8 days) is a usage error: it would fire at once.
import { spawn } from "node:child_process";

const MAX_TIMER_MS = 2 ** 31 - 1;
const GRACE_MS = 5000;
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

const [minutes, command, ...args] = process.argv.slice(2);
const capMs = Number(minutes) * 60 * 1000;
if (!(capMs > 0) || !(capMs <= MAX_TIMER_MS) || command === undefined) {
  console.error("usage: node scripts/run-with-cap.mjs <minutes, at most 35791> <command> [args...]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", detached: true });
let capped = false;
let interrupted = 0;

function killGroup(signal) {
  try {
    process.kill(-(child.pid ?? 0), signal);
  } catch {
    child.kill(signal);
  }
}

const timer = setTimeout(() => {
  capped = true;
  console.error(`run-with-cap: "${command}" did not finish within ${minutes} minute(s); its process group was killed (a hang proves nothing and fails the step)`);
  killGroup("SIGKILL");
}, capMs);

for (const [name, number] of Object.entries(SIGNALS)) {
  process.on(name, () => {
    if (interrupted === 0) {
      interrupted = number;
      console.error(`run-with-cap: ${name} received; stopping "${command}" and everything it started`);
      killGroup(name);
      setTimeout(() => killGroup("SIGKILL"), GRACE_MS).unref();
    } else {
      killGroup("SIGKILL");
    }
  });
}

child.on("error", (error) => {
  clearTimeout(timer);
  console.error(`run-with-cap: could not start "${command}": ${error.message}`);
  process.exit(127);
});
child.on("close", (code, signal) => {
  clearTimeout(timer);
  if (capped) process.exit(124);
  if (interrupted !== 0) process.exit(128 + interrupted);
  process.exit(code ?? (signal === null ? 1 : 128));
});
