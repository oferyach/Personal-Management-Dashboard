import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ActionError } from "@/lib/actionError";
import { mustAllow } from "@/lib/actionGuard";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getConfig } from "@/lib/env";
import type { ActionContext } from "@/lib/requestAuth";

export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;

const TYPES = {
  "image/png": { extension: "png" },
  "image/jpeg": { extension: "jpg" },
  "image/webp": { extension: "webp" },
} as const;

export type ProfileImageType = keyof typeof TYPES;

function validMagic(type: ProfileImageType, bytes: Uint8Array): boolean {
  if (type === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

export function profileImagesDirectory(): string {
  return resolve(getConfig().paths.dataDir, "profile-images");
}

export function validateProfileImage(type: string, bytes: Uint8Array): ProfileImageType {
  if (!(type in TYPES)) throw new ActionError("invalid_input", "IMAGE_TYPE");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROFILE_IMAGE_BYTES) {
    throw new ActionError("invalid_input", "IMAGE_SIZE");
  }
  const allowed = type as ProfileImageType;
  if (!validMagic(allowed, bytes)) throw new ActionError("invalid_input", "IMAGE_SIGNATURE");
  return allowed;
}

export async function saveProfileImage(ctx: ActionContext, file: File): Promise<string> {
  await mustAllow(ctx, "profile.edit_own");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = validateProfileImage(file.type, bytes);
  const extension = TYPES[type].extension;
  const stem = createHash("sha256").update(ctx.user.id).digest("hex");
  const filename = `${stem}.${extension}`;
  const directory = profileImagesDirectory();
  const temporary = resolve(directory, `.${stem}.${randomUUID()}.tmp`);
  const target = resolve(directory, filename);

  await mkdir(directory, { recursive: true });
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);

  const imageUrl = `/api/v1/profile/image/${filename}?v=${Date.now()}`;
  try {
    await getAuth().api.updateUser({ headers: ctx.headers, body: { image: imageUrl } });
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw new ActionError("failed", (error as { body?: { code?: string } })?.body?.code);
  }

  for (const existing of await readdir(directory)) {
    if (existing.startsWith(`${stem}.`) && existing !== filename) {
      await unlink(resolve(directory, existing)).catch(() => undefined);
    }
  }

  recordAudit({
    action: "account_updated",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    targetId: ctx.user.id,
    detail: { changed: "profile_image", mediaType: type, bytes: bytes.byteLength },
    headers: ctx.headers,
  });
  return imageUrl;
}
