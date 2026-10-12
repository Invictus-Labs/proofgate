import { ensurePack } from "./pack.js";

/** Pack and install once for the whole e2e run (vitest). */
export default function setup(): () => void {
  const { dispose } = ensurePack();
  return dispose;
}
