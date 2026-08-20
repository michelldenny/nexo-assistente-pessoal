import { camel, getSupabase } from "../../../db/supabase";
import { INCOME_CATEGORIES, TRANSACTION_CATEGORIES } from "../../categories";
import { syncMonth } from "../../../db/monthly";
type Payload = {
  kind?: "expense" | "income";
  description?: string;
  category?: string;
  amountCents?: number;
  occurredOn?: string;
  source?: "manual" | "assistant";
  recurring?: boolean;
  recurrenceDay?: number;
  recurrenceEndMonth?: string;
  action?: string;
  id?: number;
};
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const firstDayOfNextMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
function validate(p: Payload) {
  const description = p.description?.trim() ?? "",
    amount = Math.round(Number(p.amountCents)),
    date = p.occurredOn ?? "",
    category = p.category?.trim() || "";
  if (!["expense", "income"].includes(p.kind ?? ""))
    return { error: "Tipo inválido." };
  const allowed =
    p.kind === "income" ? INCOME_CATEGORIES : TRANSACTION_CATEGORIES;
  if (!allowed.includes(category as never))
    return {
      error: `Categoria inválida para ${p.kind === "income" ? "receita" : "despesa"}.`,
    };
  if (!description || description.length > 120)
    return { error: "Informe uma descrição de até 120 caracteres." };
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return { error: "Informe um valor válido." };
  if (!validDate(date)) return { error: "Informe uma data válida." };
  return {
    data: {
      kind: p.kind,
      description,
      category,
      amount_cents: amount,
      occurred_on: date,
      source: p.source === "assistant" ? "assistant" : "manual",
    },
  };
}
export async function GET(req: Request) {
  try {
    const month =
      new URL(req.url).searchParams.get("month") ??
      new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month))
      return Response.json({ error: "Mês inválido." }, { status: 400 });
    await syncMonth(month);
    const { data, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .is("deleted_at", null)
      .gte("occurred_on", `${month}-01`)
      .lt("occurred_on", firstDayOfNextMonth(month))
      .order("occurred_on", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;
    return Response.json({ transactions: (data ?? []).map((r) => camel(r)) });
  } catch (e) {
    console.error("Failed to load monthly transactions", e);
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Não foi possível carregar os lançamentos.",
      },
      { status: 500 },
    );
  }
}
export async function POST(req: Request) {
  try {
    const p = (await req.json()) as Payload,
      c = validate(p);
    if ("error" in c) return Response.json({ error: c.error }, { status: 400 });
    const db = getSupabase();
    let recurring_rule_id: null | number = null;
    if (p.recurring) {
      const day = Math.round(Number(p.recurrenceDay));
      if (day < 1 || day > 28)
        return Response.json(
          { error: "Escolha um dia entre 1 e 28." },
          { status: 400 },
        );
      const { data: rule, error: ruleError } = await db
        .from("recurring_rules")
        .insert({
          kind: c.data.kind,
          description: c.data.description,
          category: c.data.category,
          amount_cents: c.data.amount_cents,
          day_of_month: day,
          start_month: c.data.occurred_on.slice(0, 7),
          end_month: p.recurrenceEndMonth || null,
        })
        .select()
        .single();
      if (ruleError) throw ruleError;
      recurring_rule_id = rule.id;
    }
    const { data, error } = await db
      .from("transactions")
      .insert({
        ...c.data,
        occurred_on: p.recurring
          ? `${c.data.occurred_on.slice(0, 7)}-${String(Math.round(Number(p.recurrenceDay))).padStart(2, "0")}`
          : c.data.occurred_on,
        status: p.recurring ? "pending" : "settled",
        recurring_rule_id,
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json({ transaction: camel(data) }, { status: 201 });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Não foi possível criar o lançamento.",
      },
      { status: 500 },
    );
  }
}
export async function PATCH(req: Request) {
  try {
    const p = (await req.json()) as Payload,
      id = Math.round(Number(p.id)),
      db = getSupabase();
    if (!Number.isSafeInteger(id) || id <= 0)
      return Response.json({ error: "Lançamento inválido." }, { status: 400 });
    if (p.action === "toggle_status") {
      const { data: current, error: readError } = await db
        .from("transactions")
        .select("*")
        .eq("id", id)
        .single();
      if (readError) throw readError;
      const status = current.status === "settled" ? "pending" : "settled",
        { data, error } = await db
          .from("transactions")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select()
          .single();
      if (error) throw error;
      if (current.invoice_id) {
        const paid = status === "settled",
          paid_at = paid ? new Date().toISOString() : null;
        await db
          .from("card_invoices")
          .update({ status: paid ? "paid" : "open", paid_at })
          .eq("id", current.invoice_id);
        const { data: invoice } = await db
          .from("card_invoices")
          .select("*")
          .eq("id", current.invoice_id)
          .single();
        if (invoice)
          await db
            .from("card_installments")
            .update({ status: paid ? "paid" : "pending", paid_at })
            .eq("card_id", invoice.card_id)
            .eq("invoice_month", invoice.reference_month);
      }
      return Response.json({ transaction: camel(data) });
    }
    const c = validate(p);
    if ("error" in c) return Response.json({ error: c.error }, { status: 400 });
    const { data, error } = await db
      .from("transactions")
      .update({ ...c.data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    return Response.json({ transaction: camel(data) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Não foi possível editar." },
      { status: 500 },
    );
  }
}
export async function DELETE(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const id = Math.round(Number(params.get("id")));
    const scope = params.get("scope");
    const db = getSupabase();
    const { data: transaction, error: findError } = await db
      .from("transactions")
      .select("id,recurring_rule_id,occurred_on")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (findError || !transaction)
      return Response.json(
        { error: "Lançamento não encontrado." },
        { status: 404 },
      );
    const now = new Date().toISOString();
    if (scope === "all" && transaction.recurring_rule_id) {
      const all = await db
        .from("transactions")
        .update({ deleted_at: now, updated_at: now })
        .eq("recurring_rule_id", transaction.recurring_rule_id)
        .is("deleted_at", null);
      if (all.error) throw all.error;
      const rule = await db
        .from("recurring_rules")
        .update({ active: false, updated_at: now })
        .eq("id", transaction.recurring_rule_id);
      if (rule.error) throw rule.error;
      return Response.json({ deleted: true, id, scope: "all" });
    }
    if (scope === "future" && transaction.recurring_rule_id) {
      const future = await db
        .from("transactions")
        .update({ deleted_at: now, updated_at: now })
        .eq("recurring_rule_id", transaction.recurring_rule_id)
        .gte("occurred_on", transaction.occurred_on)
        .is("deleted_at", null);
      if (future.error) throw future.error;
      const rule = await db
        .from("recurring_rules")
        .update({ active: false, updated_at: now })
        .eq("id", transaction.recurring_rule_id);
      if (rule.error) throw rule.error;
      return Response.json({ deleted: true, id, scope: "future" });
    }
    const { error } = await db
      .from("transactions")
      .update({
        deleted_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
    return Response.json({ deleted: true, id });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Não foi possível excluir." },
      { status: 500 },
    );
  }
}
