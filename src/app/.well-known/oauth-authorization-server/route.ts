import { jsonResponse, preflight } from "@/lib/oauth/http";
import { authorizationServerMetadata } from "@/lib/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return jsonResponse(authorizationServerMetadata(), 200, { "Cache-Control": "public, max-age=300" });
}

export function OPTIONS() {
  return preflight();
}
