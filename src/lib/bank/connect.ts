import "server-only";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { runSync, type SyncOutcome } from "./sync";
import { SimpleFinError, claimSetupToken, providerConnectionId } from "./simplefin";

// Stores (or replaces) the single bank connection. The access URL is encrypted before it touches the database
// and is never returned to callers.
export function storeAccessUrl(accessUrl: string, institutionName: string): number {
  const db = getDb();
  const enc = encrypt(accessUrl);
  const pid = providerConnectionId(accessUrl);
  const existing = db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();
  if (existing) {
    db.update(schema.connections)
      .set({ accessTokenEnc: enc, providerConnectionId: pid, status: "active", lastError: null })
      .where(eq(schema.connections.id, existing.id))
      .run();
    return existing.id;
  }
  return db
    .insert(schema.connections)
    .values({
      provider: "simplefin",
      providerConnectionId: pid,
      institutionName,
      accessTokenEnc: enc,
      createdAt: Date.now(),
    })
    .returning({ id: schema.connections.id })
    .get().id;
}

export type ConnectResult = { ok: true; sync: SyncOutcome } | { ok: false; error: string };

// Claim a setup token, store the access URL, then run a first sync (which also fills in the institution name).
export async function connectWithSetupToken(setupToken: string): Promise<ConnectResult> {
  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(setupToken);
  } catch (e) {
    return { ok: false, error: e instanceof SimpleFinError ? e.message : "Could not claim the setup token" };
  }
  storeAccessUrl(accessUrl, "SimpleFIN");
  return { ok: true, sync: await runSync("manual") };
}
