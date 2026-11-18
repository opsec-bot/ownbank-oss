import { dbPath, openDb } from "../src/lib/db";

const db = openDb(dbPath());
db.$client.close();
console.log(`Migrations applied to ${dbPath()}`);
