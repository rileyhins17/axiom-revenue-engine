import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicWebsiteUrlError,
  normalizePublicWebsiteUrl,
} from "@/lib/revenue-engine/public-website-url";

test("normalizes source domains into canonical public URLs", () => {
  assert.equal(
    normalizePublicWebsiteUrl("  Example.COM/services?city=kw#quote  "),
    "https://example.com/services?city=kw",
  );
  assert.equal(normalizePublicWebsiteUrl("http://example.com:80"), "http://example.com/");
  assert.equal(normalizePublicWebsiteUrl("https://münchen.ca"), "https://xn--mnchen-3ya.ca/");
});

test("rejects schemes, credentials, internal names, IP literals, and unusual ports", () => {
  const blocked = [
    "file:///etc/passwd",
    "ftp://example.com/file",
    "https://user:password@example.com",
    "http://localhost",
    "http://service.internal",
    "http://printer.local",
    "http://127.0.0.1",
    "http://127.1",
    "http://2130706433",
    "http://[::1]",
    "http://169.254.169.254/latest/meta-data",
    "https://example.com:8443",
    "http://example.com:443",
  ];

  for (const value of blocked) {
    assert.throws(
      () => normalizePublicWebsiteUrl(value),
      (error) => error instanceof PublicWebsiteUrlError && error.code === "BLOCKED_URL",
      value,
    );
  }
});

test("rejects malformed, single-label, reserved, and ambiguous URLs", () => {
  const rejected = [
    "",
    "publichost",
    "https://business.test",
    "https://business.example",
    "https://example.com\\@127.0.0.1",
    "https://example.com/path with spaces",
  ];

  for (const value of rejected) {
    assert.throws(() => normalizePublicWebsiteUrl(value), PublicWebsiteUrlError, value);
  }
});
