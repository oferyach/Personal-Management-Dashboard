import { getConfig } from "@/lib/env";

/** Small runtime helpers so modules do not each reach for process.env. */

export function isProduction(): boolean {
  return getConfig().isProduction;
}

export function isTest(): boolean {
  return getConfig().isTest;
}
