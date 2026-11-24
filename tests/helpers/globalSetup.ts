import { rmSync } from "node:fs";
import { resolve } from "node:path";

/** Removes the test scratch directory before and after a Vitest run. */
export default async function globalSetup(): Promise<() => void> {
  const dir = resolve(process.cwd(), ".test-tmp");
  rmSync(dir, { recursive: true, force: true });

  return () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can still hold a SQLite handle for a moment after a worker exits.
      // The directory is git-ignored scratch space, so leaving it is not a failure.
      console.warn(`[vitest] could not remove ${dir}; it is scratch space and git-ignored.`);
    }
  };
}
