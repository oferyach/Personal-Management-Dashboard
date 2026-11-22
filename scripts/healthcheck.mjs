#!/usr/bin/env node
// Container/OS healthcheck: used by the Dockerfile HEALTHCHECK and `npm run healthcheck`.
// Exit 0 only when the app reports status "ok" over real HTTP.
const port = process.env.PORT ?? "4000";
const url = process.env.HEALTHCHECK_URL ?? `http://127.0.0.1:${port}/health`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch(url, { signal: controller.signal });
  const body = await response.json().catch(() => null);

  if (!response.ok || body?.status !== "ok") {
    console.error(
      `healthcheck failed: ${response.status} ${JSON.stringify(body?.error ?? body?.status ?? null)}`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`healthcheck failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
