import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

export const NOW = "2026-09-29T12:00:00Z";
export const NOW_MS = Date.parse(NOW);

export function sha1(label: string): string {
  return createHash("sha1").update(label).digest("hex");
}
export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
export function isoAgo(seconds: number, now = NOW_MS): string {
  return new Date(now - seconds * 1000).toISOString();
}

export interface Workspace {
  dir: string;
  manifestPath: string;
  receiptsDir: string;
  revisionsPath: string;
  outputDir: string;
  cleanup(): Promise<void>;
}

export async function makeWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "pg-test-"));
  const receiptsDir = join(dir, "receipts");
  await mkdir(receiptsDir);
  return {
    dir,
    manifestPath: join(dir, "requirements.yaml"),
    receiptsDir,
    revisionsPath: join(dir, "revisions.json"),
    outputDir: join(dir, "report"),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export const REPOS = { api: sha1("api-commit"), web: sha1("web-commit") };

export function baseRequirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "REQ-001",
    title: "Checkout API integration tests",
    severity: "mandatory",
    required_level: "integration",
    required_environment: "staging",
    max_age_seconds: 3600,
    repositories: ["api"],
    ...overrides,
  };
}

export function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    name: "demo-release-gate",
    repositories: [{ id: "api" }, { id: "web" }],
    requirements: [baseRequirement()],
    ...overrides,
  };
}

export async function writeManifest(ws: Workspace, manifest: Record<string, unknown> = baseManifest()): Promise<void> {
  await writeFile(ws.manifestPath, stringify(manifest));
}

export async function writeRevisions(ws: Workspace, revisions: Record<string, string> = REPOS): Promise<void> {
  await writeFile(
    ws.revisionsPath,
    JSON.stringify({ schema_version: 1, revisions: Object.entries(revisions).map(([repository, commit_sha]) => ({ repository, commit_sha })) }),
  );
}

let counter = 0;
export function nextId(): string {
  counter += 1;
  return uuid(1000 + counter);
}

export interface ReceiptSpec {
  receipt?: Record<string, unknown>;
  artifact?: string | Buffer;
  artifactPath?: string;
  fileName?: string;
  /** Lie about the artifact hash to simulate tampering. */
  declaredSha256?: string;
}

/** Write a native receipt plus its artifact with a correct hash (unless a lie is requested). Returns the receipt object. */
export async function writeReceipt(ws: Workspace, spec: ReceiptSpec = {}): Promise<Record<string, unknown>> {
  const id = (spec.receipt?.receipt_id as string | undefined) ?? nextId();
  const artifactPath = spec.artifactPath ?? `artifacts/${id}.xml`;
  const content = spec.artifact ?? `<testsuite name="synthetic" tests="10" id="${id}"/>`;
  const artifactFile = join(ws.receiptsDir, artifactPath);
  await mkdir(dirname(artifactFile), { recursive: true });
  await writeFile(artifactFile, content);
  const receipt: Record<string, unknown> = {
    schema_version: 1,
    receipt_id: id,
    requirement_ids: ["REQ-001"],
    repository: "api",
    commit_sha: REPOS.api,
    runner_id: "runner-synthetic-1",
    environment: "staging",
    test_level: "integration",
    execution_kind: "live",
    result: "pass",
    tests: { total: 10, passed: 10, failed: 0, skipped: 0 },
    artifact: { path: artifactPath, sha256: spec.declaredSha256 ?? sha256(content) },
    finished_at: isoAgo(60),
    ...spec.receipt,
  };
  // A caller override of `artifact` wins, so tests can point at odd paths.
  const file = join(ws.receiptsDir, spec.fileName ?? `${id}.receipt.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(receipt, null, 2));
  return receipt;
}

/** A complete passing single-requirement workspace. */
export async function passingWorkspace(): Promise<Workspace> {
  const ws = await makeWorkspace();
  await writeManifest(ws);
  await writeRevisions(ws);
  await writeReceipt(ws);
  return ws;
}
