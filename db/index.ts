import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type D1Param = Parameters<typeof drizzle>[0];

export function getDb() {
  const d1 =
    (globalThis as unknown as { env?: { DB?: D1Param } }).env?.DB ||
    (process.env as unknown as { DB?: D1Param }).DB;
  if (!d1) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  return drizzle(d1, { schema });
}
