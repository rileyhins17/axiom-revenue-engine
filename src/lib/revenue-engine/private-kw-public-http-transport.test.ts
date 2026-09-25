import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPublicAddress,
  createPrivateKwPublicHttpTransport,
  privateKwPublicHttpTransportReceiptDigest,
  type BoundPublicRequest,
} from "@/lib/revenue-engine/private-kw-public-http-transport";
import { capturePublicWebsiteDocument } from "@/lib/revenue-engine/website-capture";

const NOW = new Date("2026-09-21T15:00:00.000Z");

function resolverFor(answers: readonly { address: string; family: 4 | 6 }[]) {
  return async () => answers;
}

function response(status = 200, body = "<!doctype html><title>ok</title>") {
  return {
    statusCode: status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    abort() {},
  };
}

test("validates every answer and binds the selected public address while preserving host and TLS SNI", async () => {
  const requests: BoundPublicRequest[] = [];
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: resolverFor([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]),
    executeConnection: async (request) => {
      requests.push(request);
      return response();
    },
    now: () => NOW,
  });

  const result = await transport.request("https://Example.com/path?q=1", {
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    headers: { Accept: "text/html" },
  });
  assert.equal(result.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.address, "93.184.216.34");
  assert.equal(requests[0]?.family, 4);
  assert.equal(requests[0]?.hostname, "example.com");
  assert.equal(requests[0]?.servername, "example.com");
  assert.equal(requests[0]?.headers.Host, "example.com");
  assert.equal(requests[0]?.headers.Connection, "close");
  assert.equal(requests[0]?.agent, false);
  assert.equal(transport.takeReceipts()[0]?.networkRequestCount, 1);
  assert.equal(transport.takeReceipts()[0]?.socketOpened, true);
});

test("accepts mapped public IPv4 but rejects mapped private, loopback, metadata, and reserved answers", async () => {
  assert.equal(classifyPublicAddress("::ffff:93.184.216.34", 6), "PUBLIC");
  for (const address of [
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.10",
    "::ffff:169.254.169.254",
    "::ffff:203.0.113.10",
  ]) {
    assert.notEqual(classifyPublicAddress(address, 6), "PUBLIC", address);
  }
});

test("rejects known special IPv6 ranges and does not default unknown space to public", async () => {
  for (const address of ["100::1", "3ffe::1", "2001:20::1", "2001:1::1", "2001:30::1", "2002::1", "5000::1"]) {
    assert.notEqual(classifyPublicAddress(address, 6), "PUBLIC", address);
  }
});

test("fails closed on every non-public or malformed answer before connecting", async () => {
  const cases: Array<[string, 4 | 6]> = [
    ["127.0.0.1", 4], ["10.0.0.1", 4], ["100.64.0.1", 4],
    ["169.254.169.254", 4], ["0.0.0.0", 4], ["224.0.0.1", 4],
    ["192.0.2.1", 4], ["198.18.0.1", 4], ["240.0.0.1", 4],
    ["::", 6], ["::1", 6], ["fc00::1", 6], ["fe80::1", 6],
    ["ff02::1", 6], ["2001:db8::1", 6], ["2001:2::1", 6], ["2001:10::1", 6],
    ["not-an-ip", 4], ["127.0.0.1%1", 4],
  ];
  for (const [address, family] of cases) {
    let calls = 0;
    const transport = createPrivateKwPublicHttpTransport({
      resolveDns: resolverFor([{ address, family }]),
      executeConnection: async () => { calls += 1; return response(); },
      now: () => NOW,
    });
    await assert.rejects(() => transport.request("https://example.com/"));
    assert.equal(calls, 0, address);
    assert.equal(transport.takeReceipts()[0]?.socketOpened, false);
  }
});

test("rejects mixed, empty, DNS-failed, and family-mismatched answers", async () => {
  const variants = [
    async () => [{ address: "93.184.216.34", family: 4 as const }, { address: "10.0.0.1", family: 4 as const }],
    async () => [],
    async () => { throw new Error("dns failed"); },
    async () => [{ address: "93.184.216.34", family: 6 as const }],
  ];
  for (const resolveDns of variants) {
    let calls = 0;
    const transport = createPrivateKwPublicHttpTransport({ resolveDns, executeConnection: async () => { calls += 1; return response(); }, now: () => NOW });
    await assert.rejects(() => transport.request("https://example.com/"));
    assert.equal(calls, 0);
    assert.equal(transport.takeReceipts()[0]?.networkRequestCount, 1);
  }
});

test("re-resolves each request so a public-to-private change cannot rebind through the old hostname", async () => {
  let index = 0;
  let calls = 0;
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: async () => index++ === 0 ? [{ address: "93.184.216.34", family: 4 as const }] : [{ address: "192.168.1.5", family: 4 as const }],
    executeConnection: async () => { calls += 1; return response(); },
    now: () => NOW,
  });
  await transport.request("https://example.com/");
  await assert.rejects(() => transport.request("https://example.com/"));
  assert.equal(calls, 1);
  assert.deepEqual(transport.takeReceipts().map((receipt) => receipt.networkRequestCount), [1, 1]);
});

test("rejects caller authority, body, and automatic redirect controls", async () => {
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: resolverFor([{ address: "93.184.216.34", family: 4 }]),
    executeConnection: async () => response(),
  });
  await assert.rejects(() => transport.request("https://example.com/", { method: "POST" }));
  await assert.rejects(() => transport.request("https://example.com/", { body: "x" }));
  await assert.rejects(() => transport.request("https://example.com/", { redirect: "follow" }));
  await assert.rejects(() => transport.request("https://user:pass@example.com/"));
  await assert.rejects(() => transport.request("https://example.com/", { headers: { Authorization: "x" } }));
});

test("fits the existing bounded capture reader and revalidates a redirect before its second connection", async () => {
  let resolution = 0;
  let connections = 0;
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: async () => {
      resolution += 1;
      return resolution === 1
        ? [{ address: "93.184.216.34", family: 4 as const }]
        : [{ address: "192.168.1.4", family: 4 as const }];
    },
    executeConnection: async () => {
      connections += 1;
      return { ...response(302, ""), headers: { location: "/home" } };
    },
    now: () => NOW,
  });
  const result = await capturePublicWebsiteDocument("https://example.com/", { fetch: transport.request.bind(transport), now: () => NOW });
  assert.equal(result.outcome, "FAILED");
  assert.equal(resolution, 2);
  assert.equal(connections, 1);
  assert.equal(transport.takeReceipts().length, 2);
});

test("does not connect after an abort wins a pending DNS resolution", async () => {
  let resolveDns!: (answers: readonly { address: string; family: 4 | 6 }[]) => void;
  const dns = new Promise<readonly { address: string; family: 4 | 6 }[]>((resolve) => { resolveDns = resolve; });
  let connections = 0;
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: async () => dns,
    executeConnection: async () => { connections += 1; return response(); },
    now: () => NOW,
  });
  const controller = new AbortController();
  const pending = transport.request("https://example.com/", { signal: controller.signal });
  controller.abort();
  resolveDns([{ address: "93.184.216.34", family: 4 }]);
  await assert.rejects(pending);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(connections, 0);
});

test("aborts active response bodies and disposes unconsumed redirects and errors", async () => {
  let activeAbort = 0;
  const body = new ReadableStream<Uint8Array>({ pull() {} });
  const controller = new AbortController();
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: resolverFor([{ address: "93.184.216.34", family: 4 }]),
    executeConnection: async () => ({ statusCode: 200, headers: { "content-type": "text/html" }, body, abort: () => { activeAbort += 1; } }),
  });
  await transport.request("https://example.com/", { signal: controller.signal });
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(activeAbort, 1);

  for (const statusCode of [302, 503]) {
    let disposed = 0;
    const bounded = createPrivateKwPublicHttpTransport({
      resolveDns: resolverFor([{ address: "93.184.216.34", family: 4 }]),
      executeConnection: async () => ({ statusCode, headers: { location: "/next" }, body: new ReadableStream(), abort: () => { disposed += 1; } }),
    });
    await bounded.request("https://example.com/", { redirect: "manual" });
    assert.equal(disposed, 1, `status ${statusCode}`);
  }
});

test("receipt digest covers the complete immutable receipt", async () => {
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: resolverFor([{ address: "93.184.216.34", family: 4 }]),
    executeConnection: async () => response(200),
    now: () => NOW,
  });
  await transport.request("https://example.com/path");
  const receipt = transport.takeReceipts()[0]!;
  assert.equal(receipt.receiptDigest, privateKwPublicHttpTransportReceiptDigest(receipt));
  assert.throws(() => { (receipt as { statusCode?: number }).statusCode = 503; });
  assert.equal(receipt.statusCode, 200);
});
