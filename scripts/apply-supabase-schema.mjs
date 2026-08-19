import fs from "node:fs";
import postgres from "postgres";

const values = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
if (!values.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
const sql = postgres(values.DATABASE_URL, { ssl: "require", max: 1 });
for (const file of fs.readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) {
  await sql.unsafe(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
}
await sql.end();
console.log("supabase_schema_ok");
