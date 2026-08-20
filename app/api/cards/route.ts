import { camel, getSupabase } from "../../../db/supabase";
const addMonths = (month: string, count: number) => {
  const [y, m] = month.split("-").map(Number),
    d = new Date(Date.UTC(y, m - 1 + count, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const firstMonth = (date: string, closing: number) =>
  addMonths(date.slice(0, 7), Number(date.slice(8, 10)) > closing ? 1 : 0);
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
    const cards = (ca.data ?? []).map((r) => camel<any>(r)),
      purchases = (pu.data ?? []).map((r) => camel<any>(r)),
      installments = (ins.data ?? []).map((r) => camel<any>(r)),
      invoices = (inv.data ?? []).map((r) => camel<any>(r));
    const invoiceRows = invoices
      .map((i) => ({
        ...i,
        totalCents: installments
          .filter(
            (x) => x.cardId === i.cardId && x.invoiceMonth === i.referenceMonth,
          )
          .reduce((s: number, x: any) => s + x.amountCents, 0),
      }))
      .sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
    const debts = purchases
      .filter((p) => p.installmentCount > 1)
      .map((p) => {
        const parts = installments.filter((i) => i.purchaseId === p.id),
          paid = parts.filter((i) => i.status === "paid");
        return {
          ...p,
          paidInstallments: paid.length,
          paidCents: paid.reduce((s: number, i: any) => s + i.amountCents, 0),
          installmentCents: parts[0]?.amountCents ?? 0,
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
        total <= 0 ||
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
      const base = Math.floor(total / count),
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
    const b = (await req.json()) as { action?: string; invoiceId?: number };
    if (b.action !== "pay_invoice")
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    const db = getSupabase(),
      id = Math.round(Number(b.invoiceId)),
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
      a = await db
        .from("card_invoices")
        .update({ status: "paid", paid_at })
        .eq("id", id),
      c = await db
        .from("card_installments")
        .update({ status: "paid", paid_at })
        .eq("card_id", i.card_id)
        .eq("invoice_month", i.reference_month),
      t = await db
        .from("transactions")
        .update({ status: "settled", updated_at: paid_at })
        .eq("invoice_id", id);
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
    const id = Math.round(
      Number(new URL(req.url).searchParams.get("purchaseId")),
    );
    if (!id)
      return Response.json({ error: "Compra inválida." }, { status: 400 });
    const db = getSupabase();
    const { data: purchase, error: purchaseError } = await db
      .from("card_purchases")
      .select("id,card_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (purchaseError || !purchase)
      return Response.json(
        { error: "Compra não encontrada." },
        { status: 404 },
      );
    const { data: installments, error: installmentError } = await db
      .from("card_installments")
      .select("invoice_month")
      .eq("purchase_id", id);
    if (installmentError) throw installmentError;
    const months = [
      ...new Set((installments ?? []).map((item) => item.invoice_month)),
    ];
    const removedInstallments = await db
      .from("card_installments")
      .delete()
      .eq("purchase_id", id);
    if (removedInstallments.error) throw removedInstallments.error;
    const removedPurchase = await db
      .from("card_purchases")
      .delete()
      .eq("id", id);
    if (removedPurchase.error) throw removedPurchase.error;
    for (const month of months) {
      const [
        { data: remaining, error: remainingError },
        { data: invoice, error: invoiceError },
      ] = await Promise.all([
        db
          .from("card_installments")
          .select("amount_cents")
          .eq("card_id", purchase.card_id)
          .eq("invoice_month", month),
        db
          .from("card_invoices")
          .select("id")
          .eq("card_id", purchase.card_id)
          .eq("reference_month", month)
          .maybeSingle(),
      ]);
      if (remainingError) throw remainingError;
      if (invoiceError) throw invoiceError;
      if (!invoice) continue;
      const total = (remaining ?? []).reduce(
        (sum, item) => sum + item.amount_cents,
        0,
      );
      if (total === 0) {
        const transaction = await db
          .from("transactions")
          .delete()
          .eq("invoice_id", invoice.id);
        if (transaction.error) throw transaction.error;
        const deletedInvoice = await db
          .from("card_invoices")
          .delete()
          .eq("id", invoice.id);
        if (deletedInvoice.error) throw deletedInvoice.error;
      } else {
        const transaction = await db
          .from("transactions")
          .update({ amount_cents: total, updated_at: new Date().toISOString() })
          .eq("invoice_id", invoice.id);
        if (transaction.error) throw transaction.error;
      }
    }
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
