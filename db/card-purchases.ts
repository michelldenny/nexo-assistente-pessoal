import { camel, getSupabase } from "./supabase";

const addMonths = (month: string, count: number) => {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getInvoiceMonth = (
  purchaseDate: string,
  closingDay: number,
  dueDay: number,
) => {
  const purchaseMonth = purchaseDate.slice(0, 7);
  const day = Number(purchaseDate.slice(8, 10));
  const afterClosing = day > closingDay ? 1 : 0;
  const dueNextMonth = dueDay <= closingDay ? 1 : 0;
  return addMonths(purchaseMonth, afterClosing + dueNextMonth);
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

  const firstMonth = getInvoiceMonth(
    input.purchaseDate,
    card.closing_day,
    card.due_day,
  );
  const base = Math.trunc(input.totalCents / input.installmentCount);
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

export async function createCardPurchases(input: {
  cardName: string;
  purchases: Array<{
    description: string;
    category: string;
    purchaseDate: string;
    totalCents: number;
    installmentCount: number;
  }>;
}) {
  if (!input.purchases.length)
    throw new Error("Nenhuma compra foi identificada na fatura.");
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

  const values = input.purchases.map((purchase) => ({
    card_id: card.id,
    description: purchase.description.trim(),
    category: purchase.category,
    purchase_date: purchase.purchaseDate,
    total_cents: Math.round(purchase.totalCents),
    installment_count: Math.max(1, Math.round(purchase.installmentCount)),
  }));
  const { data: createdPurchases, error: purchaseError } = await db
    .from("card_purchases")
    .insert(values)
    .select();
  if (purchaseError) throw purchaseError;

  const installments = (createdPurchases ?? []).flatMap((created, index) => {
    const purchase = values[index];
    const firstMonth = getInvoiceMonth(
      purchase.purchase_date,
      card.closing_day,
      card.due_day,
    );
    const base = Math.trunc(purchase.total_cents / purchase.installment_count);
    const remainder = purchase.total_cents - base * purchase.installment_count;
    return Array.from({ length: purchase.installment_count }, (_, part) => ({
      purchase_id: created.id,
      card_id: card.id,
      installment_number: part + 1,
      amount_cents:
        base + (part === purchase.installment_count - 1 ? remainder : 0),
      invoice_month: addMonths(firstMonth, part),
      status: "pending",
    }));
  });
  const installmentsResult = await db
    .from("card_installments")
    .insert(installments);
  if (installmentsResult.error) throw installmentsResult.error;
  const invoiceRows = [
    ...new Set(installments.map((part) => part.invoice_month)),
  ].map((reference_month) => ({ card_id: card.id, reference_month }));
  const invoicesResult = await db.from("card_invoices").upsert(invoiceRows, {
    onConflict: "card_id,reference_month",
    ignoreDuplicates: true,
  });
  if (invoicesResult.error) throw invoicesResult.error;
  return {
    count: createdPurchases?.length ?? 0,
    card: camel<{ name: string }>(card),
  };
}
