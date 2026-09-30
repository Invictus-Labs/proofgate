// Test-only network denial. Import and call denyNetwork() in-process, or preload with
// `node --import ./tests/helpers/deny-network.mjs` to run the packaged CLI with all
// outbound network primitives replaced by throwing stubs that record the attempt.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { appendFileSync } from "node:fs";

export function denyNetwork(log = process.env.PROOFGATE_NET_LOG) {
  const attempts = [];
  const originals = [];
  const record = (what) => {
    attempts.push(what);
    if (log) appendFileSync(log, `${what}\n`);
  };
  const stub = (owner, name, label) => {
    const original = owner[name];
    originals.push(() => {
      owner[name] = original;
    });
    owner[name] = (...args) => {
      record(`${label}(${typeof args[0] === "string" ? args[0] : ""})`);
      throw new Error(`network access denied by test harness: ${label}`);
    };
  };
  for (const name of ["connect", "createConnection"]) stub(net, name, `net.${name}`);
  stub(tls, "connect", "tls.connect");
  for (const name of ["request", "get"]) {
    stub(http, name, `http.${name}`);
    stub(https, name, `https.${name}`);
  }
  for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) stub(dns, name, `dns.${name}`);
  for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) stub(dns.promises, name, `dns.promises.${name}`);
  stub(dgram, "createSocket", "dgram.createSocket");
  const originalConnect = net.Socket.prototype.connect;
  originals.push(() => {
    net.Socket.prototype.connect = originalConnect;
  });
  net.Socket.prototype.connect = function () {
    record("net.Socket.connect");
    throw new Error("network access denied by test harness: net.Socket.connect");
  };
  const originalFetch = globalThis.fetch;
  originals.push(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    record(`fetch(${String(input)})`);
    throw new Error("network access denied by test harness: fetch");
  };
  return {
    attempts,
    restore() {
      for (const undo of originals.reverse()) undo();
    },
  };
}

if (process.env.PROOFGATE_DENY_NETWORK === "1") denyNetwork();
