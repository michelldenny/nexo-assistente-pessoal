import { getSupabase } from "../../../../db/supabase";
import { INCOME_CATEGORIES, TRANSACTION_CATEGORIES } from "../../../categories";

type LegacyCard = {
  id?: string;
  name?: string;
  limit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
};
type LegacyTransaction = {
  id?: string;
  amount?: number;
  cardId?: string;
  category?: string;
  date?: string;
  description?: string;
  status?: string;
  type?: string;
  installments?: { total?: number; current?: number; groupId?: string } | null;
};
type LegacyBudget = { id?: string; category?: string; limit?: number };
type LegacyBackup = {
  backupDate?: string;
  cards?: LegacyCard[];
  transactions?: LegacyTransaction[];
  budgets?: LegacyBudget[];
  categories?: unknown[];
  debts?: unknown[];
};

const expenseCategories = new Set<string>(TRANSACTION_CATEGORIES);
const incomeCategories = new Set<string>(INCOME_CATEGORIES);
const cents = (value: unknown) => Math.round(Math.abs(Number(value)) * 100);
const legacyKey = (prefix: string, value: unknown) =>
  `${prefix}:${String(value ?? "").trim()}`;
const normalizedName = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
const normalizeDate = (value: unknown) => {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? "";
};
const addMonths = (month: string, count: number) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const firstInvoiceMonth = (
  date: string,
  closingDay: number,
  dueDay: number,
) => {
  const purchaseMonth = date.slice(0, 7);
  const day = Number(date.slice(8, 10));
  const afterClosing = day > closingDay ? 1 : 0;
  const dueNextMonth = dueDay <= closingDay ? 1 : 0;
  return addMonths(purchaseMonth, afterClosing + dueNextMonth);
};
const cardColor = (value: unknown) => {
  const color = String(value ?? "");
  if (color.includes("purple")) return "purple";
  if (color.includes("rose") || color.includes("orange")) return "coral";
  if (color.includes("blue") || color.includes("slate")) return "green";
  return "lime";
};
const categoryFor = (kind: "expense" | "income", value: unknown) => {
  const original = String(value ?? "Outros")
    .trim()
    .replace("13°", "13º");
  if (kind === "income")
    return incomeCategories.has(original) ? original : "Saldo Anterior";
  return expenseCategories.has(original) ? original : "Outros";
};
const paidStatus = (value: unknown) =>
  String(value ?? "").toUpperCase() === "COMPLETED";

function parseBackup(
  value: unknown,
): Required<
  Pick<
    LegacyBackup,
    "cards" | "transactions" | "budgets" | "categories" | "debts"
  >
> &
  LegacyBackup {
  if (!value || typeof value !== "object")
    throw new Error("O arquivo não contém um backup válido.");
  const backup = value as LegacyBackup;
  if (!Array.isArray(backup.transactions) || !Array.isArray(backup.cards))
    throw new Error("O arquivo não possui cartões e transações reconhecíveis.");
  if (backup.transactions.length > 5000 || backup.cards.length > 100)
    throw new Error("O backup ultrapassa o limite seguro de importação.");
  return {
    ...backup,
    cards: backup.cards,
    transactions: backup.transactions,
    budgets: Array.isArray(backup.budgets) ? backup.budgets : [],
    categories: Array.isArray(backup.categories) ? backup.categories : [],
    debts: Array.isArray(backup.debts) ? backup.debts : [],
  };
}

function groupCardTransactions(transactions: LegacyTransaction[]) {
  const cardRows = transactions.filter((row) => row.type === "CARD_EXPENSE");
  const groups = new Map<string, LegacyTransaction[]>();
  const singles: LegacyTransaction[] = [];
  for (const row of cardRows) {
    const groupId = row.installments?.groupId?.trim();
    if (!groupId) singles.push(row);
    else groups.set(groupId, [...(groups.get(groupId) ?? []), row]);
  }
  return { cardRows, singles, groups };
}

async function preview(backup: ReturnType<typeof parseBackup>) {
  const db = getSupabase();
  const [
    { data: cards, error: cardError },
    { data: transactions, error: txError },
    { data: purchases, error: purchaseError },
    { data: budgets, error: budgetError },
  ] = await Promise.all([
    db.from("credit_cards").select("legacy_id,name").is("deleted_at", null),
    db.from("transactions").select("legacy_id").not("legacy_id", "is", null),
    db.from("card_purchases").select("legacy_id").not("legacy_id", "is", null),
    db.from("category_budgets").select("legacy_id,category"),
  ]);
  for (const result of [cardError, txError, purchaseError, budgetError])
    if (result) throw result;

  const cardIds = new Set((cards ?? []).map((row) => row.legacy_id));
  const cardNames = new Set(
    (cards ?? []).map((row) => normalizedName(row.name)),
  );
  const txIds = new Set((transactions ?? []).map((row) => row.legacy_id));
  const purchaseIds = new Set((purchases ?? []).map((row) => row.legacy_id));
  const budgetIds = new Set((budgets ?? []).map((row) => row.legacy_id));
  const budgetCategories = new Set(
    (budgets ?? []).map((row) => normalizedName(row.category)),
  );
  const regular = backup.transactions.filter(
    (row) => row.type !== "CARD_EXPENSE",
  );
  const { singles, groups } = groupCardTransactions(backup.transactions);
  const duplicateRegular = regular.filter((row) =>
    txIds.has(legacyKey("legacy-tx", row.id)),
  ).length;
  const duplicateSingles = singles.filter((row) =>
    purchaseIds.has(legacyKey("legacy-card-tx", row.id)),
  ).length;
  const duplicateGroups = [...groups.keys()].filter((id) =>
    purchaseIds.has(legacyKey("legacy-card-group", id)),
  ).length;
  const invalidAmounts = backup.transactions.filter(
    (row) => !Number.isFinite(Number(row.amount)) || Number(row.amount) === 0,
  ).length;
  const negativeAdjustments = backup.transactions.filter(
    (row) => Number(row.amount) < 0,
  ).length;
  const partialGroups = [...groups.values()].filter((rows) => {
    const total = Math.max(
      ...rows.map((row) => Number(row.installments?.total) || 1),
    );
    return (
      new Set(rows.map((row) => Number(row.installments?.current))).size < total
    );
  }).length;

  return {
    cards: {
      total: backup.cards.length,
      new: backup.cards.filter(
        (card) =>
          !cardIds.has(legacyKey("legacy-card", card.id)) &&
          !cardNames.has(normalizedName(card.name)),
      ).length,
    },
    transactions: {
      total: regular.length,
      new: Math.max(0, regular.length - duplicateRegular - invalidAmounts),
      duplicates: duplicateRegular,
    },
    cardPurchases: {
      single: singles.length,
      installmentGroups: groups.size,
      new: singles.length + groups.size - duplicateSingles - duplicateGroups,
      duplicates: duplicateSingles + duplicateGroups,
    },
    budgets: {
      total: backup.budgets.length,
      new: backup.budgets.filter(
        (budget) =>
          !budgetIds.has(legacyKey("legacy-budget", budget.id)) &&
          !budgetCategories.has(normalizedName(budget.category)),
      ).length,
    },
    ignoredDebts: backup.debts.length,
    warnings: { invalidAmounts, negativeAdjustments, partialGroups },
  };
}

function buildInstallmentGroup(rows: LegacyTransaction[]) {
  const ordered = [...rows].sort(
    (a, b) => Number(a.installments?.current) - Number(b.installments?.current),
  );
  const total = Math.max(
    1,
    ...ordered.map((row) => Number(row.installments?.total) || 1),
  );
  const known = new Map(
    ordered.map((row) => [Number(row.installments?.current) || 1, row]),
  );
  const anchorNumber = [...known.keys()].sort((a, b) => a - b)[0];
  const anchor = known.get(anchorNumber)!;
  const anchorMonth = normalizeDate(anchor.date).slice(0, 7);
  const representative = cents(anchor.amount);
  const parts = Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    const source = known.get(number);
    return {
      number,
      amountCents: source ? cents(source.amount) : representative,
      invoiceMonth: source
        ? normalizeDate(source.date).slice(0, 7)
        : addMonths(anchorMonth, number - anchorNumber),
      status: source
        ? paidStatus(source.status)
          ? ("paid" as const)
          : ("pending" as const)
        : number < anchorNumber
          ? ("paid" as const)
          : ("pending" as const),
    };
  });
  return {
    source: anchor,
    total,
    purchaseDate: `${addMonths(anchorMonth, 1 - anchorNumber)}-01`,
    parts,
    totalCents: parts.reduce((sum, part) => sum + part.amountCents, 0),
  };
}

async function importBackup(backup: ReturnType<typeof parseBackup>) {
  const db = getSupabase();
  const report = {
    cards: 0,
    transactions: 0,
    cardPurchases: 0,
    budgets: 0,
    duplicates: 0,
    ignored: 0,
    ignoredDebts: backup.debts.length,
  };

  const { data: currentCards, error: cardReadError } = await db
    .from("credit_cards")
    .select("*")
    .is("deleted_at", null);
  if (cardReadError) throw cardReadError;
  const cardMap = new Map<string, number>();
  const cardClosingMap = new Map<string, number>();
  const cardDueMap = new Map<string, number>();
  for (const legacyCard of backup.cards) {
    const id = String(legacyCard.id ?? "").trim();
    if (!id || !legacyCard.name?.trim()) {
      report.ignored += 1;
      continue;
    }
    const key = legacyKey("legacy-card", id);
    let existing = (currentCards ?? []).find(
      (card) =>
        card.legacy_id === key ||
        normalizedName(card.name) === normalizedName(legacyCard.name),
    );
    if (existing) {
      cardMap.set(id, existing.id);
      cardClosingMap.set(id, Number(existing.closing_day) || 1);
      cardDueMap.set(id, Number(existing.due_day) || 10);
      report.duplicates += 1;
      if (!existing.legacy_id) {
        const linked = await db
          .from("credit_cards")
          .update({ legacy_id: key })
          .eq("id", existing.id);
        if (linked.error) throw linked.error;
      }
      continue;
    }
    const inserted = await db
      .from("credit_cards")
      .insert({
        legacy_id: key,
        name: legacyCard.name.trim(),
        bank: legacyCard.name.trim(),
        last_four: "0000",
        credit_limit_cents: Math.max(1, cents(legacyCard.limit)),
        closing_day: Math.min(
          28,
          Math.max(1, Math.round(Number(legacyCard.closingDay) || 1)),
        ),
        due_day: Math.min(
          28,
          Math.max(1, Math.round(Number(legacyCard.dueDay) || 10)),
        ),
        color: cardColor(legacyCard.color),
      })
      .select()
      .single();
    if (inserted.error) throw inserted.error;
    existing = inserted.data;
    cardMap.set(id, existing.id);
    cardClosingMap.set(id, Number(existing.closing_day) || 1);
    cardDueMap.set(id, Number(existing.due_day) || 10);
    report.cards += 1;
  }

  const regularRows = backup.transactions
    .filter((row) => row.type !== "CARD_EXPENSE")
    .map((row) => {
      const amount = Number(row.amount);
      const initialKind = row.type === "INCOME" ? "income" : "expense";
      const kind =
        amount < 0
          ? initialKind === "income"
            ? "expense"
            : "income"
          : initialKind;
      return {
        legacy_id: legacyKey("legacy-tx", row.id),
        kind,
        description: String(row.description ?? "Lançamento importado")
          .trim()
          .slice(0, 120),
        category: categoryFor(kind, row.category),
        amount_cents: cents(amount),
        occurred_on: normalizeDate(row.date),
        source: "manual",
        status: paidStatus(row.status) ? "settled" : "pending",
      };
    })
    .filter(
      (row) =>
        row.legacy_id !== "legacy-tx:" &&
        row.amount_cents > 0 &&
        row.occurred_on,
    );
  const { data: existingTransactions, error: txReadError } = await db
    .from("transactions")
    .select("legacy_id")
    .in(
      "legacy_id",
      regularRows.map((row) => row.legacy_id),
    );
  if (txReadError) throw txReadError;
  const existingTxIds = new Set(
    (existingTransactions ?? []).map((row) => row.legacy_id),
  );
  const newTransactions = regularRows.filter(
    (row) => !existingTxIds.has(row.legacy_id),
  );
  if (newTransactions.length) {
    const inserted = await db.from("transactions").insert(newTransactions);
    if (inserted.error) throw inserted.error;
    report.transactions += newTransactions.length;
  }
  report.duplicates += regularRows.length - newTransactions.length;
  report.ignored +=
    backup.transactions.filter((row) => row.type !== "CARD_EXPENSE").length -
    regularRows.length;

  const { singles, groups } = groupCardTransactions(backup.transactions);
  const purchaseInputs: Array<{
    legacyId: string;
    cardId: number;
    description: string;
    category: string;
    purchaseDate: string;
    totalCents: number;
    installmentCount: number;
    parts: Array<{
      number: number;
      amountCents: number;
      invoiceMonth: string;
      status: "paid" | "pending";
    }>;
  }> = [];
  for (const row of singles) {
    const legacyCardId = String(row.cardId ?? "");
    const cardId = cardMap.get(legacyCardId);
    const closingDay = cardClosingMap.get(legacyCardId) ?? 1;
    const dueDay = cardDueMap.get(legacyCardId) ?? 10;
    const amountCents = cents(row.amount);
    const date = normalizeDate(row.date);
    if (!cardId || !row.id || amountCents <= 0 || !date) {
      report.ignored += 1;
      continue;
    }
    purchaseInputs.push({
      legacyId: legacyKey("legacy-card-tx", row.id),
      cardId,
      description: String(row.description ?? "Compra importada")
        .trim()
        .slice(0, 120),
      category: categoryFor("expense", row.category),
      purchaseDate: date,
      totalCents: amountCents,
      installmentCount: 1,
      parts: [
        {
          number: 1,
          amountCents,
          invoiceMonth: firstInvoiceMonth(date, closingDay, dueDay),
          status: paidStatus(row.status) ? "paid" : "pending",
        },
      ],
    });
  }
  for (const [groupId, rows] of groups) {
    const built = buildInstallmentGroup(rows);
    const cardId = cardMap.get(String(built.source.cardId ?? ""));
    if (!cardId || built.totalCents <= 0 || !built.purchaseDate) {
      report.ignored += 1;
      continue;
    }
    purchaseInputs.push({
      legacyId: legacyKey("legacy-card-group", groupId),
      cardId,
      description: String(
        built.source.description ?? "Compra parcelada importada",
      )
        .trim()
        .slice(0, 120),
      category: categoryFor("expense", built.source.category),
      purchaseDate: built.purchaseDate,
      totalCents: built.totalCents,
      installmentCount: built.total,
      parts: built.parts,
    });
  }

  const { data: existingPurchases, error: purchaseReadError } = await db
    .from("card_purchases")
    .select("id,legacy_id")
    .in(
      "legacy_id",
      purchaseInputs.map((input) => input.legacyId),
    );
  if (purchaseReadError) throw purchaseReadError;
  const purchaseMap = new Map<string, number>(
    (existingPurchases ?? []).map((row) => [row.legacy_id, row.id]),
  );
  const newPurchaseInputs = purchaseInputs.filter(
    (input) => !purchaseMap.has(input.legacyId),
  );
  if (newPurchaseInputs.length) {
    const inserted = await db
      .from("card_purchases")
      .insert(
        newPurchaseInputs.map((input) => ({
          legacy_id: input.legacyId,
          card_id: input.cardId,
          description: input.description,
          category: input.category,
          purchase_date: input.purchaseDate,
          total_cents: input.totalCents,
          installment_count: input.installmentCount,
        })),
      )
      .select("id,legacy_id");
    if (inserted.error) throw inserted.error;
    for (const row of inserted.data ?? [])
      purchaseMap.set(row.legacy_id, row.id);
    report.cardPurchases += newPurchaseInputs.length;
  }

  const importedPurchaseIds = [...purchaseMap.values()];
  if (importedPurchaseIds.length) {
    const { data: currentParts, error: currentPartsError } = await db
      .from("card_installments")
      .select("purchase_id,installment_number")
      .in("purchase_id", importedPurchaseIds);
    if (currentPartsError) throw currentPartsError;
    const existingPartKeys = new Set(
      (currentParts ?? []).map(
        (part) => `${part.purchase_id}:${part.installment_number}`,
      ),
    );
    const installments = purchaseInputs.flatMap((input) => {
      const purchaseId = purchaseMap.get(input.legacyId);
      if (!purchaseId) return [];
      return input.parts
        .filter((part) => !existingPartKeys.has(`${purchaseId}:${part.number}`))
        .map((part) => ({
          purchase_id: purchaseId,
          card_id: input.cardId,
          installment_number: part.number,
          amount_cents: part.amountCents,
          invoice_month: part.invoiceMonth,
          status: part.status,
          paid_at: part.status === "paid" ? new Date().toISOString() : null,
        }));
    });
    if (installments.length) {
      const insertedParts = await db
        .from("card_installments")
        .insert(installments);
      if (insertedParts.error) throw insertedParts.error;
    }
  }
  report.duplicates += purchaseInputs.length - newPurchaseInputs.length;

  const affectedCardIds = [
    ...new Set(purchaseInputs.map((input) => input.cardId)),
  ];
  if (affectedCardIds.length) {
    const { data: allParts, error: partsError } = await db
      .from("card_installments")
      .select("card_id,invoice_month,status")
      .in("card_id", affectedCardIds);
    if (partsError) throw partsError;
    const invoiceGroups = new Map<string, typeof allParts>();
    for (const part of allParts ?? []) {
      const key = `${part.card_id}:${part.invoice_month}`;
      invoiceGroups.set(key, [...(invoiceGroups.get(key) ?? []), part]);
    }
    const now = new Date().toISOString();
    const invoiceRows = [...invoiceGroups.entries()].map(([key, parts]) => {
      const [cardId, referenceMonth] = key.split(":");
      const paid = parts.every((part) => part.status === "paid");
      return {
        card_id: Number(cardId),
        reference_month: referenceMonth,
        status: paid ? "paid" : "open",
        paid_at: paid ? now : null,
      };
    });
    const invoices = await db
      .from("card_invoices")
      .upsert(invoiceRows, { onConflict: "card_id,reference_month" });
    if (invoices.error) throw invoices.error;
  }

  const validBudgets = backup.budgets
    .map((budget) => ({
      legacy_id: legacyKey("legacy-budget", budget.id),
      category: String(budget.category ?? "")
        .trim()
        .replace("13°", "13º"),
      limit_cents: Math.max(0, cents(budget.limit)),
      updated_at: new Date().toISOString(),
    }))
    .filter(
      (budget) => budget.legacy_id !== "legacy-budget:" && budget.category,
    );
  if (validBudgets.length) {
    const { data: before, error: budgetReadError } = await db
      .from("category_budgets")
      .select("category")
      .in(
        "category",
        validBudgets.map((budget) => budget.category),
      );
    if (budgetReadError) throw budgetReadError;
    const existingBudgetCategories = new Set(
      (before ?? []).map((row) => row.category),
    );
    const budgets = await db
      .from("category_budgets")
      .upsert(validBudgets, { onConflict: "category" });
    if (budgets.error) throw budgets.error;
    report.budgets = validBudgets.filter(
      (budget) => !existingBudgetCategories.has(budget.category),
    ).length;
    report.duplicates += validBudgets.length - report.budgets;
  }
  return report;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      backup?: unknown;
    };
    const backup = parseBackup(body.backup);
    if (body.action === "preview")
      return Response.json({ preview: await preview(backup) });
    if (body.action !== "import")
      return Response.json(
        { error: "Ação de importação inválida." },
        { status: 400 },
      );
    return Response.json({ report: await importBackup(backup) });
  } catch (error) {
    console.error("Finance backup import failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o backup.",
      },
      { status: 500 },
    );
  }
}
