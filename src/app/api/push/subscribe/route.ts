import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const subscription = z.object({
  endpoint: z.string().url().max(2048).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(256), auth: z.string().min(10).max(256) }),
});

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Owner session required (the proxy only checks the cookie exists; this checks it is valid).
export async function POST(req: NextRequest) {
  const user = await requireApiSession();
  if (user instanceof NextResponse) return user;
  const parsed = subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid subscription" }, 400);
  const { endpoint, keys } = parsed.data;
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  getDb()
    .insert(schema.pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, createdAt: Date.now(), userAgent })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth, userAgent } })
    .run();
  return json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireApiSession();
  if (user instanceof NextResponse) return user;
  const parsed = z.object({ endpoint: z.string().max(2048) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  getDb().delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, parsed.data.endpoint)).run();
  return json({ ok: true });
}
