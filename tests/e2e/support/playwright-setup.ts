import { ensurePack } from "./pack.js";

/** Pack and install once for the browser smoke; the spec then renders real CLI output from the installed binary. */
export default function globalSetup(): () => void {
  const { dispose } = ensurePack();
  return dispose;
}
