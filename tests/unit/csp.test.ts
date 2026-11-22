import { describe, expect, it } from "vitest";
import { buildCsp, randomNonce } from "@/lib/csp";

/**
 * CSP baseline (spec §19). The E2E suite measures the headers that actually
 * reach a browser; these tests pin the policy rules so they cannot silently
 * loosen while the app grows.
 */

const NONCE = "abcdefghij0123456789AB==";

function scriptSrc(csp: string): string {
  return (csp.split("; ").find((d) => d.startsWith("script-src")) ?? "").trim();
}

describe("production CSP", () => {
  const csp = buildCsp(NONCE, { production: true, host: "dash.example.com:4000", httpsUrl: true });

  it("allows scripts only from self plus the per-request nonce", () => {
    expect(scriptSrc(csp)).toBe(`script-src 'self' 'nonce-${NONCE}'`);
  });

  it("never allows unsafe-eval or inline scripts in production", () => {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
  });

  it("blocks framing, plugins and external origins", () => {
    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "connect-src 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("asks for HTTPS only when the app is actually served over HTTPS", () => {
    expect(csp).toContain("upgrade-insecure-requests");
    const httpPolicy = buildCsp(NONCE, { production: true, httpsUrl: false });
    expect(httpPolicy).not.toContain("upgrade-insecure-requests");
  });

  it("does not leak the nonce value into a wildcard fallback", () => {
    expect(csp).not.toContain("*");
  });
});

describe("development CSP", () => {
  const csp = buildCsp(NONCE, { production: false, host: "127.0.0.1:3211" });

  it("allows the dev tooling that production forbids, scoped to this host", () => {
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://127.0.0.1:3211");
    expect(csp).not.toContain("ws://localhost:4000");
  });

  it("falls back to the documented local development port (4000) when no host is given", () => {
    const fallback = buildCsp(NONCE, { production: false });
    expect(fallback).toContain("ws://localhost:4000");
    expect(fallback).toContain("http://localhost:4000");
  });

  it("keeps framing and plugin restrictions even in development", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("never sends upgrade-insecure-requests over plain http development", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("nonce generation", () => {
  it("produces unique, correctly sized nonces", () => {
    const nonces = new Set<string>();

    for (let i = 0; i < 500; i += 1) {
      const nonce = randomNonce();
      expect(nonce).toHaveLength(24); // 16 bytes base64
      expect(nonce.endsWith("=")).toBe(true);
      nonces.add(nonce);
    }

    expect(nonces.size).toBe(500);
  });
});
