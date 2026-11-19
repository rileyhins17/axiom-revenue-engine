import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import { requireApiSession } from "@/lib/session";
import { validateProfileImage } from "@/lib/profile-image";

export async function PATCH(request: Request) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  const { session } = authResult;
  const body = await request.json();
  const { name, image } = body as { name?: string; image?: string | null };

  const data: Record<string, unknown> = {};

  if (name !== undefined) {
    const trimmed = (name ?? "").trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      return NextResponse.json(
        { error: "Name must be 1–50 characters" },
        { status: 400 }
      );
    }
    data.name = trimmed;
  }

  if (image !== undefined) {
    if (image === null) {
      data.image = null;
    } else if (typeof image === "string") {
      const problem = validateProfileImage(image);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
      data.image = image;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const fields = Object.keys(data);
  const updated = await getDatabase()
    .prepare(`UPDATE "User" SET ${fields.map((field) => `"${field}" = ?`).join(", ")}, "updatedAt" = ? WHERE "id" = ? RETURNING "id","name","email","image","role"`)
    .bind(...fields.map((field) => data[field]), new Date().toISOString(), session.user.id)
    .first<{ id: string; name: string; email: string; image: string | null; role: string | null }>();
  if (!updated) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    image: updated.image,
    role: updated.role,
  });
}
