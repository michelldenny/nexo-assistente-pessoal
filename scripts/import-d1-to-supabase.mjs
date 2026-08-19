import fs from "node:fs";
import postgres from "postgres";

const values = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
const data = JSON.parse(fs.readFileSync("work/d1-export.json", "utf8"));
const sql = postgres(values.DATABASE_URL, { ssl: "require", max: 1 });
const order = ["transactions","calendar_events","credit_cards","card_purchases","card_installments","card_invoices"];
for (const table of order) {
  const rows = data[table] ?? [];
  if (rows.length) {
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const normalized = rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null])));
    await sql`insert into ${sql(`public.${table}`)} ${sql(normalized, ...columns)} on conflict (id) do nothing`;
  }
  await sql.unsafe(`select setval(pg_get_serial_sequence('public.${table}','id'), coalesce((select max(id) from public.${table}), 1), true)`);
}
await sql.end();
console.log("supabase_import_ok");
