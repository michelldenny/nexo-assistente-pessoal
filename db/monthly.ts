import { getSupabase } from "./supabase";

const inFlight = new Map<string, Promise<void>>();

function dateInMonth(month: string, requestedDay: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = Math.min(Math.max(1, requestedDay), lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

async function performSyncMonth(month: string) {
  const db = getSupabase();
  const [rulesResult, invoicesResult, cardsResult, partsResult] =
    await Promise.all([
      db
        .from("recurring_rules")
        .select("*")
        .eq("active", true)
        .lte("start_month", month),
      db.from("card_invoices").select("*").eq("reference_month", month),
      db.from("credit_cards").select("*").is("deleted_at", null),
      db.from("card_installments").select("*").eq("invoice_month", month),
    ]);
  for (const result of [rulesResult, invoicesResult, cardsResult, partsResult])
    if (result.error) throw result.error;

  const recurring = (rulesResult.data ?? [])
    .filter((rule) => !rule.end_month || rule.end_month >= month)
    .map((rule) => ({
      kind: rule.kind,
      description: rule.description,
      category: rule.category,
      amount_cents: rule.amount_cents,
      occurred_on: dateInMonth(month, rule.day_of_month),
      source: "manual" as const,
      status: "pending" as const,
      recurring_rule_id: rule.id,
    }));

  const cardMap = Object.fromEntries(
    (cardsResult.data ?? []).map((card) => [card.id, card]),
  );
  const invoiceRows = (invoicesResult.data ?? [])
    .map((invoice) => {
      const card = cardMap[invoice.card_id];
      const total = (partsResult.data ?? [])
        .filter((part) => part.card_id === invoice.card_id)
        .reduce((sum, part) => sum + part.amount_cents, 0);
      return card && total
        ? {
            kind: "expense" as const,
            description: `Fatura ${card.name}`,
            category: "Outros",
            amount_cents: total,
            occurred_on: dateInMonth(month, card.due_day),
            source: "manual" as const,
            status: (invoice.status === "paid" ? "settled" : "pending") as
              "settled" | "pending",
            invoice_id: invoice.id,
          }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const writes: PromiseLike<{ error: unknown }>[] = [];
  if (recurring.length)
    writes.push(
      db
        .from("transactions")
        .upsert(recurring, {
          onConflict: "recurring_rule_id,occurred_on",
          ignoreDuplicates: true,
        }),
    );
  if (invoiceRows.length)
    writes.push(
      db.from("transactions").upsert(invoiceRows, { onConflict: "invoice_id" }),
    );
  const results = await Promise.all(writes);
  for (const result of results) if (result.error) throw result.error;
}

export async function syncMonth(month: string) {
  const running = inFlight.get(month);
  if (running) return running;
  const promise = performSyncMonth(month).finally(() => inFlight.delete(month));
  inFlight.set(month, promise);
  return promise;
}
