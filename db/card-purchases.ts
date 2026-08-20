import { camel, getSupabase } from "./supabase";

const addMonths = (month: string, count: number) => {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function createCardPurchase(input: {
  cardName: string;
  description: string;
  category: string;
  purchaseDate: string;
  totalCents: number;
  installmentCount: number;
}) {
  const db = getSupabase();
  const { data: cards, error: cardError } = await db
    .from("credit_cards")
    .select("*")
    .is("deleted_at", null);
  if (cardError) throw cardError;
  const key = input.cardName.trim().toLocaleLowerCase("pt-BR");
  const card = (cards ?? []).find((item) => {
    const name = String(item.name).toLocaleLowerCase("pt-BR");
    const bank = String(item.bank).toLocaleLowerCase("pt-BR");
    return (
      name === key || bank === key || name.includes(key) || bank.includes(key)
    );
  });
  if (!card)
    throw new Error(
      `Não encontrei o cartão “${input.cardName}”. Cadastre-o ou informe o apelido correto.`,
    );

  const { data: purchase, error } = await db
    .from("card_purchases")
    .insert({
      card_id: card.id,
      description: input.description.trim(),
      category: input.category,
      purchase_date: input.purchaseDate,
      total_cents: input.totalCents,
      installment_count: input.installmentCount,
    })
    .select()
    .single();
  if (error) throw error;

  const firstMonth = addMonths(
    input.purchaseDate.slice(0, 7),
    Number(input.purchaseDate.slice(8, 10)) > card.closing_day ? 1 : 0,
  );
  const base = Math.floor(input.totalCents / input.installmentCount);
  const remainder = input.totalCents - base * input.installmentCount;
  const installments = Array.from(
    { length: input.installmentCount },
    (_, index) => ({
      purchase_id: purchase.id,
      card_id: card.id,
      installment_number: index + 1,
      amount_cents:
        base + (index === input.installmentCount - 1 ? remainder : 0),
      invoice_month: addMonths(firstMonth, index),
      status: "pending",
    }),
  );
  const inserted = await db.from("card_installments").insert(installments);
  if (inserted.error) throw inserted.error;
  const invoices = [
    ...new Set(installments.map((item) => item.invoice_month)),
  ].map((reference_month) => ({ card_id: card.id, reference_month }));
  const created = await db.from("card_invoices").upsert(invoices, {
    onConflict: "card_id,reference_month",
    ignoreDuplicates: true,
  });
  if (created.error) throw created.error;
  return { purchase: camel(purchase), card: camel(card) };
}
