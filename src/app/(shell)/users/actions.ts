"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ActionError, type NoticeCode } from "@/lib/actionError";
import { isRoleKey } from "@/lib/rbac";
import { actionContext, type ActionContext } from "@/lib/requestAuth";
import {
  assignUserRole,
  createManagedUser,
  resetUserPassword,
  revokeUserSessions,
  setAccountActive,
} from "@/lib/userAdministration";

/**
 * Server Actions for account administration (1.2–1.4). Same shape as the settings
 * actions: parse the form, then let the service authorize the effect and do the work
 * through Better Auth's endpoints. Page-level permission checks are not the safety
 * boundary — these functions are.
 *
 * A generated password never travels through the URL. The redirect carries the new
 * account's id only; the page reads the value from the one-shot store, which holds it
 * for one render.
 */

const USERS_PATH = "/users";
const form = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

async function outcome(
  work: (ctx: ActionContext) => Promise<{ done: string; params?: Record<string, string> }>,
): Promise<
  { done: string } | { notice: NoticeCode } | (Record<string, string> & { done: string })
> {
  try {
    const result = await work(await actionContext());
    return { done: result.done, ...result.params };
  } catch (error) {
    if (error instanceof ActionError) return { notice: error.notice };
    return { notice: "failed" };
  }
}

function finish(result: Awaited<ReturnType<typeof outcome>>): never {
  revalidatePath(USERS_PATH);
  redirect(`${USERS_PATH}?${new URLSearchParams(result).toString()}`);
}

export async function createUserAction(formData: FormData): Promise<never> {
  const role = form(formData, "role");
  if (!isRoleKey(role)) return finish({ notice: "not_assignable" });

  return finish(
    await outcome(async (ctx) => {
      const created = await createManagedUser(ctx, {
        name: form(formData, "name"),
        email: form(formData, "email"),
        role,
      });
      return { done: "accountCreated", params: { shown: created.user.id } };
    }),
  );
}

export async function changeRoleAction(formData: FormData): Promise<never> {
  const role = form(formData, "role");
  if (!isRoleKey(role)) return finish({ notice: "not_assignable" });

  return finish(
    await outcome(async (ctx) => {
      await assignUserRole(ctx, form(formData, "userId"), role);
      return { done: "roleChanged" };
    }),
  );
}

export async function setAccountActiveAction(formData: FormData): Promise<never> {
  const active = form(formData, "active") === "true";

  return finish(
    await outcome(async (ctx) => {
      await setAccountActive(ctx, form(formData, "userId"), active, form(formData, "reason"));
      return { done: active ? "accountReactivated" : "accountDeactivated" };
    }),
  );
}

export async function revokeUserSessionsAction(formData: FormData): Promise<never> {
  return finish(
    await outcome(async (ctx) => {
      await revokeUserSessions(ctx, form(formData, "userId"));
      return { done: "sessionsRevoked" };
    }),
  );
}

export async function resetUserPasswordAction(formData: FormData): Promise<never> {
  return finish(
    await outcome(async (ctx) => {
      const result = await resetUserPassword(ctx, form(formData, "userId"));
      return { done: "passwordReset", params: { shown: result.user.id } };
    }),
  );
}
