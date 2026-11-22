import { rmSync } from "node:fs";
import { resolve } from "node:path";

/** Removes the test scratch directory before and after a Vitest run. */
export default async function globalSetup(): Promise<() => void> {
  const dir = resolve(process.cwd(), ".test-tmp");
  rmSync(dir, { recursive: true, force: true });

  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
