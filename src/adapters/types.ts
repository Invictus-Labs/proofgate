import type { Receipt } from "../schemas.js";

export interface AdapterInfo {
  name: string;
  version: number;
  provenance: "native" | "fixture" | "operator_capture";
}

export interface AdapterOutput {
  receipt: Receipt;
  adapter: AdapterInfo;
}
