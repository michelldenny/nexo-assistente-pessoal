import { getSupabase } from "./supabase";
export async function syncMonth(month: string) {
  const db = getSupabase();
  const { data: rules, error: re } = await db
    .from("recurring_rules")
    .select("*")
    .eq("active", true)
    .lte("start_month", month);
  if (re) throw re;
  const recurring = (rules ?? [])
    .filter((r) => !r.end_month || r.end_month >= month)
    .map((r) => ({
      kind: r.kind,
      description: r.description,
      category: r.category,
      amount_cents: r.amount_cents,
      occurred_on: `${month}-${String(r.day_of_month).padStart(2, "0")}`,
      source: "manual",
      status: "pending",
      recurring_rule_id: r.id,
    }));
  if (recurring.length) {
    const { error } = await db
      .from("transactions")
      .upsert(recurring, {
        onConflict: "recurring_rule_id,occurred_on",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }
  const [
    { data: invoices, error: ie },
    { data: cards, error: ce },
    { data: parts, error: pe },
  ] = await Promise.all([
    db.from("card_invoices").select("*").eq("reference_month", month),
    db.from("credit_cards").select("*").is("deleted_at", null),
    db.from("card_installments").select("*").eq("invoice_month", month),
  ]);
  if (ie) throw ie;
  if (ce) throw ce;
  if (pe) throw pe;
  const cardMap = Object.fromEntries((cards ?? []).map((c) => [c.id, c]));
  const rows = (invoices ?? [])
    .map((i) => {
      const c = cardMap[i.card_id],
        total = (parts ?? [])
          .filter((p) => p.card_id === i.card_id)
          .reduce((s, p) => s + p.amount_cents, 0);
      return c && total
        ? {
            kind: "expense",
            description: `Fatura ${c.name}`,
            category: "Outros",
            amount_cents: total,
            occurred_on: `${month}-${String(c.due_day).padStart(2, "0")}`,
            source: "manual",
            status: i.status === "paid" ? "settled" : "pending",
            invoice_id: i.id,
          }
        : null;
    })
    .filter(Boolean);
  if (rows.length) {
    const { error } = await db
      .from("transactions")
      .upsert(rows, { onConflict: "invoice_id" });
    if (error) throw error;
  }
}
