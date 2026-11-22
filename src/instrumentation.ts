/**
 * Next.js startup entry. Thin on purpose: every Node-only module (env + fs,
 * native SQLite, process control) is imported dynamically so nothing Node
 * specific is compiled into the Edge variant of this file.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NEXT_PHASE === "phase-production-build") {
    const { validateBuildConfiguration } = await import("@/lib/serverStart");
    validateBuildConfiguration();
    return;
  }

  const { startServerRuntime } = await import("@/lib/serverStart");
  startServerRuntime();
}
