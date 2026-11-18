import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/request";
import { runSync } from "@/lib/bank/sync";
import { allowHit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 6;

function secretMatches(provided: string | null): boolean {
  const expected = process.env.SYNC_SECRET;
  if (!provided || !expected) return false;
  // Hash both sides so the comparison is constant time and length-independent.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Owner session OR X-Sync-Secret. The proxy lets this path through, so auth is checked here.
export async function POST(req: NextRequest) {
  const viaSecret = secretMatches(req.headers.get("x-sync-secret"));
  if (!viaSecret) {
    const user = await requireApiSession();
    if (user instanceof NextResponse) return user;
  }
  if (!allowHit("sync:api", HOUR_MS, MAX_PER_HOUR)) {
    return NextResponse.json({ error: "Rate limit: 6 syncs per hour" }, { status: 429, headers: { "Retry-After": "3600" } });
  }
  const out = await runSync("manual");
  if (out.ok) return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  if ("skipped" in out) return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(out, { status: 502, headers: { "Cache-Control": "no-store" } });
}
