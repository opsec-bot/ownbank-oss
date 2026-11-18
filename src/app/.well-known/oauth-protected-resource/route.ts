import { jsonResponse, preflight } from "@/lib/oauth/http";
import { protectedResourceMetadata } from "@/lib/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return jsonResponse(protectedResourceMetadata(), 200, { "Cache-Control": "public, max-age=300" });
}

export function OPTIONS() {
  return preflight();
}
