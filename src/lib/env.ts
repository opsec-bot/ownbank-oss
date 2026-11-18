import "server-only";
import { z } from "zod";

// Empty strings (from a copied .env.example) count as unset.
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  DATABASE_PATH: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("./data/ownbank.db")),
  TOKEN_ENC_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "TOKEN_ENC_KEY must be 32 bytes, base64"),
  APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().default("http://localhost:3000")),
  SYNC_SECRET: optional,
  MCP_TOKEN: optional,
  HELIUS_RPC_URL: optional, // secret: the URL embeds the API key
  MCP_WRITE_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()),
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
