import { getSupabase } from "../../../db/supabase";

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
const localDate = (offset = 0) => {
  const date = new Date(Date.now() + offset * 86400000);
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
};

export async function GET(request: Request) {
  try {
    const month =
      new URL(request.url).searchParams.get("month") ?? localDate().slice(0, 7);
    const db = getSupabase();
    const [
      { data: transactions, error: transactionError },
      { data: parts, error: partError },
      { data: cards, error: cardError },
    ] = await Promise.all([
      db
        .from("transactions")
        .select("description,amount_cents,occurred_on,status,kind")
        .is("deleted_at", null)
        .eq("occurred_on", localDate(1))
        .eq("kind", "expense")
        .eq("status", "pending"),
      db
        .from("card_installments")
        .select("card_id,amount_cents")
        .eq("invoice_month", month),
      db.from("credit_cards").select("id,name").is("deleted_at", null),
    ]);
    if (transactionError) throw transactionError;
    if (partError) throw partError;
    if (cardError) throw cardError;
    const messages: string[] = [];
    const dueTomorrow = transactions ?? [];
    if (dueTomorrow.length === 1)
      messages.push(
        `Você tem uma despesa a vencer amanhã: ${dueTomorrow[0].description}, no valor de ${money(dueTomorrow[0].amount_cents)}.`,
      );
    if (dueTomorrow.length > 1)
      messages.push(
        `Você tem ${dueTomorrow.length} despesas a vencer amanhã, totalizando ${money(dueTomorrow.reduce((sum, item) => sum + item.amount_cents, 0))}.`,
      );
    const totals = new Map<number, number>();
    for (const part of parts ?? [])
      totals.set(
        part.card_id,
        (totals.get(part.card_id) ?? 0) + part.amount_cents,
      );
    const leader = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    if (leader) {
      const card = (cards ?? []).find((item) => item.id === leader[0]);
      if (card)
        messages.push(
          `Seu maior gasto no cartão neste mês está no ${card.name}: ${money(leader[1])}.`,
        );
    }
    if (!messages.length)
      messages.push(
        "Seu mês está organizado: não encontrei despesas vencendo amanhã nem gastos em cartões neste período.",
      );
    return Response.json({ messages });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível gerar as análises.",
      },
      { status: 500 },
    );
  }
}
