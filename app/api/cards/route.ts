import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { cardInstallments, cardInvoices, cardPurchases, creditCards } from "../../../db/schema";

const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const addMonths = (month: string, count: number) => {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const firstInvoiceMonth = (date: string, closingDay: number) => addMonths(date.slice(0, 7), Number(date.slice(8, 10)) > closingDay ? 1 : 0);

export async function GET() {
  try {
    const db = getDb();
    const [cards, purchases, installments, invoices] = await Promise.all([
      db.select().from(creditCards).where(isNull(creditCards.deletedAt)),
      db.select().from(cardPurchases).where(isNull(cardPurchases.deletedAt)),
      db.select().from(cardInstallments),
      db.select().from(cardInvoices),
    ]);
    const invoiceRows = invoices.map(invoice => ({
      ...invoice,
      totalCents: installments.filter(i => i.cardId === invoice.cardId && i.invoiceMonth === invoice.referenceMonth).reduce((s, i) => s + i.amountCents, 0),
    })).sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
    const debts = purchases.filter(p => p.installmentCount > 1).map(purchase => {
      const parts = installments.filter(i => i.purchaseId === purchase.id);
      const paid = parts.filter(i => i.status === "paid");
      return { ...purchase, paidInstallments: paid.length, paidCents: paid.reduce((s, i) => s + i.amountCents, 0), installmentCents: parts[0]?.amountCents ?? 0 };
    });
    return Response.json({ cards, purchases, installments, invoices: invoiceRows, debts });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os cartões." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    if (body.action === "create_card") {
      const name = String(body.name ?? "").trim(), bank = String(body.bank ?? "").trim(), lastFour = String(body.lastFour ?? "").replace(/\D/g, "").slice(-4);
      const creditLimitCents = Math.round(Number(body.creditLimitCents)), closingDay = Math.round(Number(body.closingDay)), dueDay = Math.round(Number(body.dueDay));
      if (!name || !bank || lastFour.length !== 4 || creditLimitCents <= 0 || closingDay < 1 || closingDay > 28 || dueDay < 1 || dueDay > 28) return Response.json({ error: "Preencha os dados do cartão corretamente." }, { status: 400 });
      const [card] = await db.insert(creditCards).values({ name, bank, lastFour, creditLimitCents, closingDay, dueDay, color: String(body.color ?? "green") }).returning();
      return Response.json({ card }, { status: 201 });
    }
    if (body.action === "create_purchase") {
      const cardId = Math.round(Number(body.cardId)), totalCents = Math.round(Number(body.totalCents)), count = Math.round(Number(body.installmentCount));
      const description = String(body.description ?? "").trim(), category = String(body.category ?? "Outros"), purchaseDate = String(body.purchaseDate ?? "");
      const [card] = await db.select().from(creditCards).where(and(eq(creditCards.id, cardId), isNull(creditCards.deletedAt)));
      if (!card || !description || !validDate(purchaseDate) || totalCents <= 0 || count < 1 || count > 60) return Response.json({ error: "Preencha os dados da compra corretamente." }, { status: 400 });
      const [purchase] = await db.insert(cardPurchases).values({ cardId, description, category, purchaseDate, totalCents, installmentCount: count }).returning();
      const base = Math.floor(totalCents / count), remainder = totalCents - base * count, firstMonth = firstInvoiceMonth(purchaseDate, card.closingDay);
      const values = Array.from({ length: count }, (_, index) => ({ purchaseId: purchase.id, cardId, installmentNumber: index + 1, amountCents: base + (index === count - 1 ? remainder : 0), invoiceMonth: addMonths(firstMonth, index), status: "pending" as const }));
      await db.insert(cardInstallments).values(values);
      for (const month of [...new Set(values.map(v => v.invoiceMonth))]) {
        const exists = await db.select().from(cardInvoices).where(and(eq(cardInvoices.cardId, cardId), eq(cardInvoices.referenceMonth, month)));
        if (!exists.length) await db.insert(cardInvoices).values({ cardId, referenceMonth: month });
      }
      return Response.json({ purchase }, { status: 201 });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível salvar." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { action?: string; invoiceId?: number };
    if (body.action !== "pay_invoice") return Response.json({ error: "Ação inválida." }, { status: 400 });
    const id = Math.round(Number(body.invoiceId));
    const db = getDb();
    const [invoice] = await db.select().from(cardInvoices).where(eq(cardInvoices.id, id));
    if (!invoice) return Response.json({ error: "Fatura não encontrada." }, { status: 404 });
    const paidAt = new Date().toISOString();
    await db.update(cardInvoices).set({ status: "paid", paidAt }).where(eq(cardInvoices.id, id));
    await db.update(cardInstallments).set({ status: "paid", paidAt }).where(and(eq(cardInstallments.cardId, invoice.cardId), eq(cardInstallments.invoiceMonth, invoice.referenceMonth)));
    return Response.json({ paid: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível pagar a fatura." }, { status: 500 }); }
}
