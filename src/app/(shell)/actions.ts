"use server";

import { redirect } from "next/navigation";

import { signOutCurrentSession } from "@/lib/requestAuth";

/**
 * Signing out is a form POST, so it works with JavaScript disabled (1.6). The
 * session row is deleted server-side; a client that "clears its cookies" cannot
 * sign anything out.
 */
export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect("/login?reason=signedOut");
}
