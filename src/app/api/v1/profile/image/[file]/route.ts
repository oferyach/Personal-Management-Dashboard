import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { like } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { profileImagesDirectory } from "@/lib/profileImage";
import { can } from "@/lib/rbac";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

const FILE = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const actor = await resolveApiUser("profile.view_own");
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });

  const { file } = await params;
  const match = FILE.exec(file);
  if (!match) return Response.json({ error: "not_found" }, { status: 404 });

  const owner = getDb()
    .select({ id: users.id })
    .from(users)
    .where(like(users.image, `/api/v1/profile/image/${file}?v=%`))
    .get();
  if (!owner) return Response.json({ error: "not_found" }, { status: 404 });
  const mayReadDirectory = await can(actor.user.actor, "users.view_directory");
  if (owner && owner.id !== actor.user.id && !mayReadDirectory) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await readFile(resolve(profileImagesDirectory(), file));
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": CONTENT_TYPES[match[1]!] ?? "application/octet-stream",
        "cache-control": "private, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
