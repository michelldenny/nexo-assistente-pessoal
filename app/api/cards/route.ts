import { camel, getSupabase } from "../../../db/supabase";
const addMonths = (month: string, count: number) => {
  const [y, m] = month.split("-").map(Number),
    d = new Date(Date.UTC(y, m - 1 + count, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const firstMonth = (date: string, closing: number) =>
  addMonths(date.slice(0, 7), Number(date.slice(8, 10)) > closing ? 1 : 0);
async function reconcileInvoiceMonth(
  db: ReturnType<typeof getSupabase>,
  cardId: number,
  referenceMonth: string,
) {
  const [
    { data: parts, error: partsError },
    { data: invoice, error: invoiceError },
  ] = await Promise.all([
    db
      .from("card_installments")
      .select("amount_cents,status")
      .eq("card_id", cardId)
      .eq("invoice_month", referenceMonth),
    db
      .from("card_invoices")
      .select("id,status")
      .eq("card_id", cardId)
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
  ]);
  if (partsError) throw partsError;
  if (invoiceError) throw invoiceError;
  if (!parts?.length) {
    if (!invoice) return;
    try {
      await db
        .from("transactions")
        .delete()
        .eq("invoice_id", invoice.id);
    } catch {
      // ignora erro ao remover transação derivada
    }
    const removed = await db
      .from("card_invoices")
      .delete()
      .eq("id", invoice.id);
    if (removed.error) throw removed.error;
    return;
  }
  const total = parts.reduce(
      (sum, part) => sum + Number(part.amount_cents || 0),
      0,
    ),
    isPaid = parts.every((part) => part.status === "paid"),
    paidAt = isPaid ? new Date().toISOString() : null;
  let invoiceId = invoice?.id as number | undefined;
  if (invoiceId) {
    const updated = await db
      .from("card_invoices")
      .update({ status: isPaid ? "paid" : "open", paid_at: paidAt })
      .eq("id", invoiceId);
    if (updated.error) throw updated.error;
  } else {
    const inserted = await db
      .from("card_invoices")
      .insert({
        card_id: cardId,
        reference_month: referenceMonth,
        status: isPaid ? "paid" : "open",
        paid_at: paidAt,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    invoiceId = inserted.data.id;
  }
  try {
    await db
      .from("transactions")
      .update({
        amount_cents: total,
        status: isPaid ? "settled" : "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("invoice_id", invoiceId);
  } catch {
    // ignora erro ao sincronizar transação derivada
  }
}
type CardRow = {
  id: number;
  name: string;
  bank: string;
  lastFour: string;
  creditLimitCents: number;
  closingDay: number;
  dueDay: number;
  color: string;
};
type PurchaseRow = {
  id: number;
  cardId: number;
  description: string;
  category: string;
  purchaseDate: string;
  totalCents: number;
  installmentCount: number;
};
type InstallmentRow = {
  id: number;
  purchaseId: number;
  cardId: number;
  installmentNumber: number;
  amountCents: number;
  invoiceMonth: string;
  status: "pending" | "paid";
};
type InvoiceRow = {
  id: number;
  cardId: number;
  referenceMonth: string;
  status: "open" | "paid";
};

export async function GET() {
  try {
    const db = getSupabase(),
      [ca, pu, ins, inv] = await Promise.all([
        db.from("credit_cards").select("*").is("deleted_at", null),
        db.from("card_purchases").select("*").is("deleted_at", null),
        db.from("card_installments").select("*"),
        db.from("card_invoices").select("*"),
      ]);
    for (const r of [ca, pu, ins, inv]) if (r.error) throw r.error;
    const cards = (ca.data ?? []).map((r) => camel<CardRow>(r)),
      purchases = (pu.data ?? []).map((r) => camel<PurchaseRow>(r)),
      installments = (ins.data ?? []).map((r) => camel<InstallmentRow>(r)),
      invoices = (inv.data ?? []).map((r) => camel<InvoiceRow>(r));
    const invoiceRows = invoices
      .map((i) => ({
        ...i,
        totalCents: installments
          .filter(
            (x) => x.cardId === i.cardId && x.invoiceMonth === i.referenceMonth,
          )
          .reduce((s: number, x) => s + x.amountCents, 0),
      }))
      .sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
    const debts = purchases
      .filter((p) => Number(p.installmentCount) > 1)
      .map((p) => {
        const parts = installments
          .filter((i) => i.purchaseId === p.id)
          .sort(
            (a, b) => Number(a.installmentNumber) - Number(b.installmentNumber),
          );
        const paid = parts.filter((i) => i.status === "paid");
        const startMonth =
          typeof parts[0]?.invoiceMonth === "string"
            ? parts[0].invoiceMonth
            : String(p.purchaseDate ?? "").slice(0, 7);
        const endMonth =
          typeof parts[parts.length - 1]?.invoiceMonth === "string"
            ? String(parts[parts.length - 1].invoiceMonth)
            : addMonths(
                startMonth,
                Math.max(0, Number(p.installmentCount) - 1),
              );
        return {
          ...p,
          startDate: p.purchaseDate,
          startMonth,
          endMonth,
          paidInstallments: paid.length,
          paidCents: paid.reduce(
            (s: number, i) => s + (Number(i.amountCents) || 0),
            0,
          ),
          installmentCents: Number(parts[0]?.amountCents) || 0,
        };
      });
    return Response.json({
      cards,
      purchases,
      installments,
      invoices: invoiceRows,
      debts,
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Não foi possível carregar os cartões.",
      },
      { status: 500 },
    );
  }
}
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>,
      db = getSupabase();
    if (b.action === "create_card") {
      const name = String(b.name ?? "").trim(),
        bank = String(b.bank ?? "").trim(),
        last = String(b.lastFour ?? "")
          .replace(/\D/g, "")
          .slice(-4),
        limit = Math.round(Number(b.creditLimitCents)),
        closing = Math.round(Number(b.closingDay)),
        due = Math.round(Number(b.dueDay));
      if (
        !name ||
        !bank ||
        last.length !== 4 ||
        limit <= 0 ||
        closing < 1 ||
        closing > 28 ||
        due < 1 ||
        due > 28
      )
        return Response.json(
          { error: "Preencha os dados do cartão corretamente." },
          { status: 400 },
        );
      const { data, error } = await db
        .from("credit_cards")
        .insert({
          name,
          bank,
          last_four: last,
          credit_limit_cents: limit,
          closing_day: closing,
          due_day: due,
          color: String(b.color ?? "green"),
        })
        .select()
        .single();
      if (error) throw error;
      return Response.json({ card: camel(data) }, { status: 201 });
    }
    if (b.action === "create_purchase") {
      const cardId = Math.round(Number(b.cardId)),
        total = Math.round(Number(b.totalCents)),
        count = Math.round(Number(b.installmentCount)),
        description = String(b.description ?? "").trim(),
        category = String(b.category ?? "Outros"),
        date = String(b.purchaseDate ?? "");
      const { data: card, error: cardError } = await db
        .from("credit_cards")
        .select("*")
        .eq("id", cardId)
        .is("deleted_at", null)
        .single();
      if (
        cardError ||
        !card ||
        !description ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        total === 0 ||
        !Number.isSafeInteger(total) ||
        count < 1 ||
        count > 60
      )
        return Response.json(
          { error: "Preencha os dados da compra corretamente." },
          { status: 400 },
        );
      const { data: p, error } = await db
        .from("card_purchases")
        .insert({
          card_id: cardId,
          description,
          category,
          purchase_date: date,
          total_cents: total,
          installment_count: count,
        })
        .select()
        .single();
      if (error) throw error;
      const base = Math.trunc(total / count),
        rem = total - base * count,
        first = firstMonth(date, card.closing_day),
        values = Array.from({ length: count }, (_, i) => ({
          purchase_id: p.id,
          card_id: cardId,
          installment_number: i + 1,
          amount_cents: base + (i === count - 1 ? rem : 0),
          invoice_month: addMonths(first, i),
          status: "pending",
        }));
      const ir = await db.from("card_installments").insert(values);
      if (ir.error) throw ir.error;
      const months = [...new Set(values.map((v) => v.invoice_month))],
        rows = months.map((reference_month) => ({
          card_id: cardId,
          reference_month,
        }));
      const fr = await db.from("card_invoices").upsert(rows, {
        onConflict: "card_id,reference_month",
        ignoreDuplicates: true,
      });
      if (fr.error) throw fr.error;
      return Response.json({ purchase: camel(p) }, { status: 201 });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Não foi possível salvar." },
      { status: 500 },
    );
  }
}
export async function PATCH(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const db = getSupabase();
    if (b.action === "update_card") {
      const id = Math.round(Number(b.cardId)),
        name = String(b.name ?? "").trim(),
        bank = String(b.bank ?? "").trim(),
        last = String(b.lastFour ?? "")
          .replace(/\D/g, "")
          .slice(-4),
        limit = Math.round(Number(b.creditLimitCents)),
        closing = Math.round(Number(b.closingDay)),
        due = Math.round(Number(b.dueDay));
      if (
        !id ||
        !name ||
        !bank ||
        last.length !== 4 ||
        limit <= 0 ||
        closing < 1 ||
        closing > 28 ||
        due < 1 ||
        due > 28
      )
        return Response.json(
          { error: "Preencha os dados do cartão corretamente." },
          { status: 400 },
        );
      const { data, error } = await db
        .from("credit_cards")
        .update({
          name,
          bank,
          last_four: last,
          credit_limit_cents: limit,
          closing_day: closing,
          due_day: due,
          color: String(b.color ?? "green"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .is("deleted_at", null)
        .select()
        .single();
      if (error) throw error;
      return Response.json({ card: camel(data) });
    }
    if (b.action === "update_purchase") {
      const id = Math.round(Number(b.purchaseId)),
        cardId = Math.round(Number(b.cardId)),
        total = Math.round(Number(b.totalCents)),
        count = Math.round(Number(b.installmentCount)),
        description = String(b.description ?? "").trim(),
        category = String(b.category ?? "Outros"),
        date = String(b.purchaseDate ?? "");
      const [purchaseResult, cardResult, installmentResult] = await Promise.all(
        [
          db
            .from("card_purchases")
            .select("id,card_id")
            .eq("id", id)
            .is("deleted_at", null)
            .single(),
          db
            .from("credit_cards")
            .select("id,closing_day")
            .eq("id", cardId)
            .is("deleted_at", null)
            .single(),
          db
            .from("card_installments")
            .select("card_id,installment_number,invoice_month,status")
            .eq("purchase_id", id),
        ],
      );
      if (
        purchaseResult.error ||
        !purchaseResult.data ||
        cardResult.error ||
        !cardResult.data
      )
        return Response.json(
          { error: "Compra ou cartão não encontrado." },
          { status: 404 },
        );
      if (
        !description ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        total === 0 ||
        !Number.isSafeInteger(total) ||
        count < 1 ||
        count > 60
      )
        return Response.json(
          { error: "Preencha os dados da compra corretamente." },
          { status: 400 },
        );
      if (installmentResult.error) throw installmentResult.error;
      const oldParts = installmentResult.data ?? [],
        paidNumbers = new Set(
          oldParts
            .filter((part) => part.status === "paid")
            .map((part) => Number(part.installment_number)),
        ),
        base = Math.trunc(total / count),
        remainder = total - base * count,
        first = firstMonth(date, cardResult.data.closing_day),
        now = new Date().toISOString(),
        values = Array.from({ length: count }, (_, index) => {
          const number = index + 1,
            paid = paidNumbers.has(number);
          return {
            purchase_id: id,
            card_id: cardId,
            installment_number: number,
            amount_cents: base + (index === count - 1 ? remainder : 0),
            invoice_month: addMonths(first, index),
            status: paid ? "paid" : "pending",
            paid_at: paid ? now : null,
          };
        });
      const updated = await db
        .from("card_purchases")
        .update({
          card_id: cardId,
          description,
          category,
          purchase_date: date,
          total_cents: total,
          installment_count: count,
        })
        .eq("id", id);
      if (updated.error) throw updated.error;
      const upserted = await db
        .from("card_installments")
        .upsert(values, { onConflict: "purchase_id,installment_number" });
      if (upserted.error) throw upserted.error;
      const extraParts = await db
        .from("card_installments")
        .delete()
        .eq("purchase_id", id)
        .gt("installment_number", count);
      if (extraParts.error) throw extraParts.error;
      const affected = new Map<string, { cardId: number; month: string }>();
      for (const part of oldParts)
        affected.set(`${part.card_id}:${part.invoice_month}`, {
          cardId: Number(part.card_id),
          month: String(part.invoice_month),
        });
      for (const part of values)
        affected.set(`${part.card_id}:${part.invoice_month}`, {
          cardId: part.card_id,
          month: part.invoice_month,
        });
      await Promise.all(
        Array.from(affected.values()).map((item) =>
          reconcileInvoiceMonth(db, item.cardId, item.month),
        ),
      );
      return Response.json({ updated: true });
    }
    if (b.action !== "pay_invoice")
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    const id = Math.round(Number(b.invoiceId)),
      { data: i, error } = await db
        .from("card_invoices")
        .select("*")
        .eq("id", id)
        .single();
    if (error || !i)
      return Response.json(
        { error: "Fatura não encontrada." },
        { status: 404 },
      );
    const paid_at = new Date().toISOString(),
      [a, c, t] = await Promise.all([
        db.from("card_invoices").update({ status: "paid", paid_at }).eq("id", id),
        db
          .from("card_installments")
          .update({ status: "paid", paid_at })
          .eq("card_id", i.card_id)
          .eq("invoice_month", i.reference_month),
        db
          .from("transactions")
          .update({ status: "settled", updated_at: paid_at })
          .eq("invoice_id", id),
      ]);
    if (a.error) throw a.error;
    if (c.error) throw c.error;
    if (t.error) throw t.error;
    return Response.json({ paid: true });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Não foi possível pagar a fatura.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const cardId = Math.round(Number(params.get("cardId")));
    const id = Math.round(Number(params.get("purchaseId")));
    const db = getSupabase();
    if (cardId) {
      const { data: invoices, error: invoiceError } = await db
        .from("card_invoices")
        .select("id")
        .eq("card_id", cardId);
      if (invoiceError) throw invoiceError;
      const invoiceIds = (invoices ?? []).map((invoice) => invoice.id);
      if (invoiceIds.length) {
        const transactions = await db
          .from("transactions")
          .delete()
          .in("invoice_id", invoiceIds);
        if (transactions.error) throw transactions.error;
      }
      const tableDeletes = await Promise.all([
        db.from("card_installments").delete().eq("card_id", cardId),
        db.from("card_purchases").delete().eq("card_id", cardId),
        db.from("card_invoices").delete().eq("card_id", cardId),
      ]);
      for (const td of tableDeletes) {
        if (td.error) throw td.error;
      }
      const removedCard = await db
        .from("credit_cards")
        .delete()
        .eq("id", cardId);
      if (removedCard.error) throw removedCard.error;
      return Response.json({ deleted: true });
    }
    if (!id)
      return Response.json({ error: "Compra inválida." }, { status: 400 });
    const { data: purchase, error: purchaseError } = await db
      .from("card_purchases")
      .select("id,card_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (purchaseError) throw purchaseError;
    if (!purchase) {
      return Response.json({ deleted: true });
    }
    const { data: installments, error: installmentError } = await db
      .from("card_installments")
      .select("invoice_month")
      .eq("purchase_id", id);
    if (installmentError) throw installmentError;
    const months = [
      ...new Set((installments ?? []).map((item) => item.invoice_month)),
    ];
    const [removedInstallments, removedPurchase] = await Promise.all([
      db.from("card_installments").delete().eq("purchase_id", id),
      db.from("card_purchases").delete().eq("id", id),
    ]);
    if (removedInstallments.error) throw removedInstallments.error;
    if (removedPurchase.error) throw removedPurchase.error;

    await Promise.all(
      months.map((month) => reconcileInvoiceMonth(db, purchase.card_id, month)),
    );
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível excluir a compra.",
      },
      { status: 500 },
    );
  }
}
