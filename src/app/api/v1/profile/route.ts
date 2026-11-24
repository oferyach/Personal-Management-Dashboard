import { z } from "zod";

import { updateDisplayName } from "@/lib/accountSecurity";
import { enforceSensitiveActionRateLimit } from "@/lib/actionGuard";
import { actionContextForApi, apiErrorResponse, parseJson, requireSameOrigin } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { readPreferences, savePreferences } from "@/lib/preferences";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    language: z.enum(["he", "en"]).nullable().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    theme: z.enum(["system", "light", "dark"]).optional(),
    workweekDays: z.number().int().min(5).max(7).optional(),
    workdayStartHour: z.number().int().min(0).max(23).optional(),
    workdayEndHour: z.number().int().min(0).max(23).optional(),
    defaultTaskReminderOffsets: z.array(z.number().int().min(0).max(10080)).max(20).optional(),
    defaultCalendarReminderOffsets: z.array(z.number().int().min(0).max(10080)).max(20).optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  const actor = await resolveApiUser("profile.view_own");
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  const { id, name, email, image, role, twoFactorEnabled } = actor.user;
  return Response.json({
    data: { id, name, email, image, role, twoFactorEnabled, preferences: readPreferences(id) },
  });
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser("settings.edit_own");
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const input = await parseJson(request, updateSchema);
    const ctx = actionContextForApi(actor.user, request);
    enforceSensitiveActionRateLimit(ctx, "settings.edit_own");
    if (input.name !== undefined) await updateDisplayName(ctx, input.name);
    const preferences = savePreferences(actor.user.id, {
      language: input.language,
      timezone: input.timezone,
      theme: input.theme,
      workweekDays: input.workweekDays,
      workdayStartHour: input.workdayStartHour,
      workdayEndHour: input.workdayEndHour,
      defaultTaskReminderOffsets: input.defaultTaskReminderOffsets,
      defaultCalendarReminderOffsets: input.defaultCalendarReminderOffsets,
    });
    recordAudit({
      action: "preferences_updated",
      outcome: "success",
      actorUserId: actor.user.id,
      targetKind: "preferences",
      targetId: actor.user.id,
      headers: request.headers,
    });
    return Response.json({ data: { preferences } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
