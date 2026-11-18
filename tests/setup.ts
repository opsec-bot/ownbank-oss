// Fixed test env so lib/env.ts validates. Real secrets never appear in tests.
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_PATH = ":memory:";
process.env.APP_URL = "http://localhost:3000";
