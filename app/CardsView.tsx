"use client";
import { useEffect, useMemo, useState } from "react";
import { CATEGORY_COLORS, TRANSACTION_CATEGORIES } from "./categories";
import ConfirmDialog from "./ConfirmDialog";
import { formatMoneyInput, formatMonth, parseMoneyInput } from "./ui-format";
type Card = {
  id: number;
  name: string;
  bank: string;
  lastFour: string;
  creditLimitCents: number;
  closingDay: number;
  dueDay: number;
  color: string;
};
type Invoice = {
  id: number;
  cardId: number;
  referenceMonth: string;
  status: "open" | "paid";
  totalCents: number;
};
type Debt = {
  id: number;
  cardId: number;
  description: string;
  category: string;
  totalCents: number;
  installmentCount: number;
  paidInstallments: number;
  paidCents: number;
  installmentCents: number;
  startMonth?: string;
  endMonth?: string;
  startDate?: string;
};
type Purchase = {
  id: number;
  cardId: number;
  description: string;
  category: string;
  purchaseDate: string;
  totalCents: number;
  installmentCount: number;
};
type Installment = {
  id: number;
  purchaseId: number;
  cardId: number;
  installmentNumber: number;
  amountCents: number;
  invoiceMonth: string;
  status: "pending" | "paid";
};
type Data = {
  cards: Card[];
  invoices: Invoice[];
  debts: Debt[];
  purchases: Purchase[];
  installments: Installment[];
};
type DebtSort =
  | "newest"
  | "oldest"
  | "balance_desc"
  | "balance_asc"
  | "progress_desc"
  | "progress_asc"
  | "installment_desc"
  | "installment_asc";
type PurchaseSort = {
  field: "date" | "value";
  direction: "asc" | "desc";
};
const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const emptyCard = {
  name: "",
  bank: "",
  lastFour: "",
  creditLimit: "0,00",
  closingDay: "10",
  dueDay: "17",
  color: "green",
};
const emptyPurchase = {
  cardId: "",
  description: "",
  category: "Outros",
  purchaseDate: today(),
  total: "0,00",
  installmentCount: "1",
  valueMode: "total" as "total" | "installment",
};
const CATEGORY_ICONS: Record<string, string> = {
  Alimentação: "🍔",
  Apê: "🏠",
  Assinaturas: "📱",
  Besteira: "🍕",
  Carro: "🚗",
  Comemoração: "🎉",
  "Doação e Oferta": "🙌",
  Estudos: "📚",
  Ifood: "🛍️",
  Imposto: "📋",
  Investimento: "📈",
  Lazer: "🎮",
  Lucas: "👤",
  Mercado: "🛒",
  Pessoal: "👤",
  Presente: "🎁",
  Saúde: "💊",
  Transporte: "🚙",
  Viagem: "✈️",
  Outros: "🏷️",
};
export default function CardsView({
  mode,
  onNotice,
  selectedMonth,
  onMonthChange,
}: {
  mode: "cards" | "debts";
  onNotice: (m: string) => void;
  selectedMonth?: string;
  onMonthChange?: (m: string) => void;
}) {
  const [data, setData] = useState<Data>({
    cards: [],
    invoices: [],
    debts: [],
    purchases: [],
    installments: [],
  });
  const [cardModal, setCardModal] = useState(false),
    [purchaseModal, setPurchaseModal] = useState(false),
    [selectedCard, setSelectedCard] = useState<Card | null>(null),
    [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null),
    [cardToDelete, setCardToDelete] = useState<Card | null>(null),
    [editingCardId, setEditingCardId] = useState<number | null>(null),
    [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [debtSort, setDebtSort] = useState<DebtSort>("newest");
  const [showCompletedDebts, setShowCompletedDebts] = useState(false);
  const [chartYear, setChartYear] = useState(() =>
    Number((selectedMonth || today()).slice(0, 4)),
  );
  const [purchaseSort, setPurchaseSort] = useState<PurchaseSort>({
    field: "date",
    direction: "desc",
  });
  const [card, setCard] = useState(emptyCard),
    [purchase, setPurchase] = useState(emptyPurchase);

  const sortedCards = useMemo(() => {
    return [...data.cards].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
    );
  }, [data.cards]);

  const cardMap = useMemo(
    () => Object.fromEntries(sortedCards.map((c) => [c.id, c])),
    [sortedCards],
  );
  const sortedDebts = useMemo(() => {
    const dateKey = (debt: Debt) =>
      debt.startDate || `${debt.startMonth || "0000-00"}-01`;
    const balance = (debt: Debt) =>
      Math.max(0, debt.totalCents - debt.paidCents);
    const progress = (debt: Debt) =>
      debt.installmentCount ? debt.paidInstallments / debt.installmentCount : 0;
    return data.debts
      .filter(
        (debt) =>
          showCompletedDebts || debt.paidInstallments < debt.installmentCount,
      )
      .sort((a, b) => {
        switch (debtSort) {
          case "oldest":
            return dateKey(a).localeCompare(dateKey(b));
          case "balance_desc":
            return balance(b) - balance(a);
          case "balance_asc":
            return balance(a) - balance(b);
          case "progress_desc":
            return progress(b) - progress(a);
          case "progress_asc":
            return progress(a) - progress(b);
          case "installment_desc":
            return b.installmentCents - a.installmentCents;
          case "installment_asc":
            return a.installmentCents - b.installmentCents;
          default:
            return dateKey(b).localeCompare(dateKey(a));
        }
      });
  }, [data.debts, debtSort, showCompletedDebts]);
  const selectedCardPurchases = useMemo(() => {
    if (!selectedCard) return [];
    const referenceMonth = selectedMonth || today().slice(0, 7);
    return data.purchases
      .filter((item) => item.cardId === selectedCard.id)
      .map((item) => {
        const installments = data.installments
            .filter((part) => part.purchaseId === item.id)
            .sort((a, b) => a.installmentNumber - b.installmentNumber),
          installment = installments.find(
            (part) => part.invoiceMonth === referenceMonth,
          );
        if (!installment) return null;
        return {
          ...item,
          currentInstallmentNumber: installment.installmentNumber,
          installmentCents: installment.amountCents,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        const comparison =
          purchaseSort.field === "date"
            ? a.purchaseDate.localeCompare(b.purchaseDate)
            : a.installmentCents - b.installmentCents;
        return purchaseSort.direction === "asc" ? comparison : -comparison;
      });
  }, [
    data.installments,
    data.purchases,
    purchaseSort,
    selectedCard,
    selectedMonth,
  ]);
  const activeMonth = selectedMonth || today().slice(0, 7);

  const fourteenMonths = useMemo(() => {
    const list: string[] = [`${chartYear - 1}-12`];
    for (let m = 1; m <= 12; m++) {
      list.push(`${chartYear}-${String(m).padStart(2, "0")}`);
    }
    list.push(`${chartYear + 1}-01`);
    return list;
  }, [chartYear]);

  const invoiceTotalsMap = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const invoice of data.invoices) {
      if (invoice.totalCents !== 0) {
        totals[invoice.referenceMonth] =
          (totals[invoice.referenceMonth] ?? 0) + invoice.totalCents;
      }
    }
    return totals;
  }, [data.invoices]);

  const fourteenMonthsTotals = useMemo(() => {
    return fourteenMonths.map((chartMonth) => {
      const total = invoiceTotalsMap[chartMonth] ?? 0;
      const isPrevYear = chartMonth.startsWith(String(chartYear - 1));
      const isNextYear = chartMonth.startsWith(String(chartYear + 1));
      const isSelected = chartMonth === activeMonth;
      return {
        month: chartMonth,
        total,
        isPrevYear,
        isNextYear,
        isSelected,
      };
    });
  }, [fourteenMonths, invoiceTotalsMap, chartYear, activeMonth]);

  const chartMax = Math.max(
    ...fourteenMonthsTotals.map((item) => item.total),
    1,
  );

  async function load() {
    try {
      const r = await fetch("/api/cards", { cache: "no-store" }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setData(b);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Não foi possível carregar.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function openNewCard() {
    setEditingCardId(null);
    setCard(emptyCard);
    setCardModal(true);
  }
  function openCardPurchases(item: Card) {
    setPurchaseSort({ field: "date", direction: "desc" });
    setSelectedCard(item);
  }
  function openNewPurchase(cardId?: number) {
    setEditingPurchaseId(null);
    setPurchase({
      ...emptyPurchase,
      cardId: cardId ? String(cardId) : "",
    });
    setPurchaseModal(true);
  }
  function openEditPurchase(item: Purchase) {
    setEditingPurchaseId(item.id);
    setPurchase({
      cardId: String(item.cardId),
      description: item.description,
      category: item.category,
      purchaseDate: item.purchaseDate,
      total: formatMoneyInput(String(item.totalCents)),
      installmentCount: String(item.installmentCount),
      valueMode: "total",
    });
    setPurchaseModal(true);
  }
  function closePurchaseModal() {
    setPurchaseModal(false);
    setEditingPurchaseId(null);
    setPurchase(emptyPurchase);
  }
  function togglePurchaseSort(field: PurchaseSort["field"]) {
    setPurchaseSort((current) => ({
      field,
      direction:
        current.field === field && current.direction === "desc"
          ? "asc"
          : "desc",
    }));
  }
  function openEditCard(item: Card) {
    setEditingCardId(item.id);
    setCard({
      name: item.name,
      bank: item.bank,
      lastFour: item.lastFour,
      creditLimit: formatMoneyInput(String(item.creditLimitCents)),
      closingDay: String(item.closingDay),
      dueDay: String(item.dueDay),
      color: item.color,
    });
    setCardModal(true);
  }
  async function saveCard() {
    setSaving(true);
    try {
      const creditLimitCents = parseMoneyInput(card.creditLimit),
        r = await fetch("/api/cards", {
          method: editingCardId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: editingCardId ? "update_card" : "create_card",
            cardId: editingCardId,
            ...card,
            creditLimitCents,
          }),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setCardModal(false);
      setCard(emptyCard);
      setEditingCardId(null);
      onNotice(editingCardId ? "Cartão atualizado." : "Cartão cadastrado.");
      void load();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  async function removeCard(item: Card) {
    const previousData = data;
    setSelectedCard(null);
    setCardToDelete(null);
    setData((prev) => ({
      ...prev,
      cards: prev.cards.filter((c) => c.id !== item.id),
      purchases: prev.purchases.filter((p) => p.cardId !== item.id),
      installments: prev.installments.filter((i) => i.cardId !== item.id),
      invoices: prev.invoices.filter((inv) => inv.cardId !== item.id),
      debts: prev.debts.filter((d) => d.cardId !== item.id),
    }));
    onNotice("Cartão excluído.");
    try {
      const response = await fetch(`/api/cards?cardId=${item.id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível excluir o cartão.");
      void load();
    } catch (e) {
      setData(previousData);
      onNotice(e instanceof Error ? e.message : "Não foi possível excluir o cartão.");
    }
  }
  async function savePurchase() {
    setSaving(true);
    try {
      const enteredCents = parseMoneyInput(purchase.total),
        installmentCount = Number(purchase.installmentCount),
        totalCents =
          purchase.valueMode === "installment"
            ? enteredCents * installmentCount
            : enteredCents;
      if (
        !purchase.cardId ||
        !purchase.description.trim() ||
        totalCents === 0 ||
        !Number.isSafeInteger(totalCents)
      ) {
        throw new Error("Preencha todos os campos corretamente.");
      }
      const r = await fetch("/api/cards", {
        method: editingPurchaseId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: editingPurchaseId ? "update_purchase" : "create_purchase",
          purchaseId: editingPurchaseId,
          ...purchase,
          cardId: Number(purchase.cardId),
          totalCents,
          installmentCount,
        }),
      }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      closePurchaseModal();
      onNotice(
        editingPurchaseId
          ? "Transação atualizada."
          : totalCents < 0
            ? "Estorno adicionado à fatura."
            : Number(purchase.installmentCount) > 1
              ? "Compra adicionada às Dívidas."
              : "Compra adicionada à fatura.",
      );
      void load();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  async function removePurchase(item: Purchase) {
    const previousData = data;
    setPurchaseToDelete(null);
    setData((prev) => ({
      ...prev,
      purchases: prev.purchases.filter((p) => p.id !== item.id),
      installments: prev.installments.filter((i) => i.purchaseId !== item.id),
      debts: prev.debts.filter((d) => d.id !== item.id),
    }));
    try {
      const response = await fetch(`/api/cards?purchaseId=${item.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível excluir a transação.");
      }
      onNotice("Transação excluída.");
      void load();
    } catch (e) {
      setData(previousData);
      onNotice(e instanceof Error ? e.message : "Não foi possível excluir.");
    }
  }
  function purchaseForm() {
    const isNegative = purchase.total.includes("-");
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <button className="modal-close" onClick={closePurchaseModal}>
            ×
          </button>
          <p className="eyebrow">
            {editingPurchaseId
              ? isNegative
                ? "EDITAR ESTORNO"
                : "EDITAR COMPRA"
              : isNegative
                ? "NOVO ESTORNO"
                : "NOVA COMPRA"}
          </p>
          <h2>
            {editingPurchaseId
              ? "Editar transação"
              : isNegative
                ? "Adicionar estorno / crédito"
                : "Adicionar à fatura"}
          </h2>
          <label>
            Cartão
            <select
              value={purchase.cardId}
              onChange={(e) =>
                setPurchase({ ...purchase, cardId: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {sortedCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.lastFour}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descrição
            <input
              placeholder={isNegative ? "Ex.: Estorno de compra cancelada" : "Ex.: Supermercado, Restaurante..."}
              value={purchase.description}
              onChange={(e) =>
                setPurchase({ ...purchase, description: e.target.value })
              }
            />
          </label>
          <div className="purchase-value-mode">
            <span>Tipo de lançamento</span>
            <div>
              <button
                type="button"
                className={!isNegative ? "selected" : ""}
                onClick={() => {
                  const cleaned = purchase.total.replace(/^-/, "");
                  setPurchase({ ...purchase, total: cleaned || "0,00" });
                }}
              >
                ＋ Compra / Despesa
              </button>
              <button
                type="button"
                className={isNegative ? "selected refund-selected" : ""}
                onClick={() => {
                  const val = purchase.total.replace(/^-/, "");
                  setPurchase({ ...purchase, total: `-${val || "0,00"}` });
                }}
              >
                − Estorno / Crédito
              </button>
            </div>
            <small>
              {isNegative
                ? "O valor será registrado como negativo e abaterá o total da sua fatura."
                : "Lançamento de despesa padrão que soma ao total da fatura."}
            </small>
          </div>
          <div className="purchase-value-mode">
            <span>O valor informado é</span>
            <div>
              <button
                className={purchase.valueMode === "total" ? "selected" : ""}
                onClick={() => setPurchase({ ...purchase, valueMode: "total" })}
              >
                Valor total
              </button>
              <button
                className={
                  purchase.valueMode === "installment" ? "selected" : ""
                }
                onClick={() =>
                  setPurchase({ ...purchase, valueMode: "installment" })
                }
              >
                Valor da parcela
              </button>
            </div>
            <small>
              {purchase.valueMode === "total"
                ? "O sistema dividirá este valor pela quantidade de parcelas."
                : "O total da compra será calculado multiplicando o valor pela quantidade de parcelas."}
            </small>
          </div>
          <div className="field-row">
            <label>
              {purchase.valueMode === "total"
                ? "Valor total"
                : "Valor da parcela"}
              <input
                inputMode="decimal"
                value={purchase.total}
                onChange={(e) =>
                  setPurchase({
                    ...purchase,
                    total: formatMoneyInput(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Data
              <input
                type="date"
                value={purchase.purchaseDate}
                onChange={(e) =>
                  setPurchase({ ...purchase, purchaseDate: e.target.value })
                }
              />
            </label>
          </div>
          <div className="field-row">
            <label>
              Categoria
              <select
                value={purchase.category}
                onChange={(e) =>
                  setPurchase({ ...purchase, category: e.target.value })
                }
              >
                {TRANSACTION_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Parcelas
              <input
                type="number"
                min="1"
                max="60"
                value={purchase.installmentCount}
                onChange={(e) =>
                  setPurchase({ ...purchase, installmentCount: e.target.value })
                }
              />
            </label>
          </div>
          <button
            className="primary wide"
            disabled={saving}
            onClick={() => void savePurchase()}
          >
            {saving
              ? "Salvando…"
              : editingPurchaseId
                ? "Salvar alterações"
                : isNegative
                  ? "Adicionar estorno"
                  : "Adicionar compra"}
          </button>
        </div>
      </div>
    );
  }
  if (loading) return <div className="agenda-empty">Carregando…</div>;
  if (mode === "debts") {
    const active = data.debts.filter(
        (d) => d.paidInstallments < d.installmentCount,
      ),
      total = data.debts.reduce((s, d) => s + d.totalCents, 0),
      paid = data.debts.reduce((s, d) => s + d.paidCents, 0),
      balance = Math.max(0, total - paid),
      pct = total ? Math.round((paid / total) * 100) : 0;
    return (
      <>
        <div className="agenda-toolbar">
          <div>
            <p className="eyebrow">PARCELAMENTOS</p>
            <h2>Minhas Dívidas</h2>
          </div>
          <button
            className="primary"
            disabled={!data.cards.length}
            onClick={() => openNewPurchase()}
          >
            ＋ Nova compra
          </button>
        </div>
        <section className="debt-overview">
          <article className="debt-kpi">
            <small>DÍVIDAS ATIVAS</small>
            <strong>{active.length}</strong>
            <span>
              {active.length === 1
                ? "parcelamento em andamento"
                : "parcelamentos em andamento"}
            </span>
          </article>
          <article className="debt-kpi">
            <small>SALDO DEVEDOR</small>
            <strong>{money(balance)}</strong>
            <span>valor restante consolidado</span>
          </article>
          <article className="debt-total-progress">
            <div>
              <small>PROGRESSO GERAL</small>
              <strong>{pct}% concluído</strong>
              <span>
                {money(paid)} pagos de {money(total)}
              </span>
            </div>
            <div className="general-progress">
              <i style={{ width: `${pct}%` }} />
            </div>
            <footer>
              <span>
                Total pago<strong>{money(paid)}</strong>
              </span>
              <span>
                Falta pagar<strong>{money(balance)}</strong>
              </span>
            </footer>
          </article>
        </section>
        <div className="section-title">
          <div>
            <p className="eyebrow">DETALHAMENTO</p>
            <h3>Parcelamentos</h3>
          </div>
          <div className="debt-controls">
            <button
              type="button"
              className={`completed-toggle ${showCompletedDebts ? "active" : ""}`}
              aria-pressed={showCompletedDebts}
              onClick={() => setShowCompletedDebts((current) => !current)}
            >
              <i aria-hidden="true" />
              Mostrar concluídas
            </button>
            <label className="debt-sort">
              <span>Ordenar por</span>
              <select
                value={debtSort}
                onChange={(event) =>
                  setDebtSort(event.target.value as DebtSort)
                }
              >
                <option value="newest">Mais atuais</option>
                <option value="oldest">Mais antigas</option>
                <option value="balance_desc">Saldo devedor: maior</option>
                <option value="balance_asc">Saldo devedor: menor</option>
                <option value="progress_desc">% paga: maior</option>
                <option value="progress_asc">% paga: menor</option>
                <option value="installment_desc">
                  Valor da parcela: maior
                </option>
                <option value="installment_asc">Valor da parcela: menor</option>
              </select>
            </label>
          </div>
        </div>
        <div className="debt-grid">
          {sortedDebts.length ? (
            sortedDebts.map((d) => {
              const itemPct = Math.round(
                (d.paidInstallments / d.installmentCount) * 100,
              );
              return (
                <article className="debt-card" key={d.id}>
                  <div className="debt-head">
                    <div>
                      <small>
                        {cardMap[d.cardId]?.name} · {d.category}
                      </small>
                      <h3>{d.description}</h3>
                    </div>
                    <div className="debt-progress-label">
                      <strong>{itemPct}% pago</strong>
                      <span>
                        {d.paidInstallments}/{d.installmentCount}
                      </span>
                    </div>
                  </div>
                  <div className="progress">
                    <i style={{ width: `${itemPct}%` }} />
                  </div>
                  <div className="debt-stats">
                    <span>
                      Saldo devedor
                      <strong>{money(d.totalCents - d.paidCents)}</strong>
                    </span>
                    <span>
                      Total pago<strong>{money(d.paidCents)}</strong>
                    </span>
                    <span>
                      Valor parcela<strong>{money(d.installmentCents)}</strong>
                    </span>
                  </div>
                  <div className="debt-timeline">
                    <span>
                      Início:{" "}
                      <strong>
                        {formatMonth(
                          d.startMonth || d.startDate?.slice(0, 7) || "",
                        )}
                      </strong>
                    </span>
                    <span>
                      Término: <strong>{formatMonth(d.endMonth || "")}</strong>
                    </span>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="agenda-empty">
              <strong>
                {data.debts.length
                  ? "Todos os parcelamentos estão concluídos."
                  : "Nenhuma dívida parcelada."}
              </strong>
              <small>
                {data.debts.length
                  ? "Ative “Mostrar concluídas” para visualizar o histórico."
                  : "Compras em mais de 1x aparecerão aqui."}
              </small>
            </div>
          )}
        </div>
        {purchaseModal && purchaseForm()}
      </>
    );
  }

  return (
    <>
      <div className="agenda-toolbar">
        <div>
          <p className="eyebrow">CRÉDITO</p>
          <h2>Cartões e Faturas</h2>
        </div>
        <div className="agenda-tools">
          <button onClick={openNewCard}>＋ Cadastrar cartão</button>
          <button
            className="primary"
            disabled={!sortedCards.length}
            onClick={() => openNewPurchase()}
          >
            ＋ Nova compra
          </button>
        </div>
      </div>
      {!sortedCards.length ? (
        <div className="agenda-empty">
          <strong>Cadastre seu primeiro cartão.</strong>
          <small>Informe limite, fechamento e vencimento.</small>
          <button onClick={openNewCard}>Cadastrar cartão</button>
        </div>
      ) : (
        <div className="cards-grid">
          {sortedCards.map((c) => {
            const cardInvoices = data.invoices.filter(
                (invoice) => invoice.cardId === c.id && invoice.totalCents !== 0,
              ),
              openInvoices = cardInvoices.filter(
                (invoice) => invoice.status === "open",
              ),
              used = openInvoices.reduce((s, i) => s + i.totalCents, 0),
              current = cardInvoices.find(
                (invoice) => invoice.referenceMonth === activeMonth,
              ),
              available = Math.max(0, c.creditLimitCents - used),
              pct = Math.min(
                100,
                Math.round((used / c.creditLimitCents) * 100),
              );
            return (
              <article
                role="button"
                tabIndex={0}
                className={`credit-card ${c.color}`}
                key={c.id}
                onClick={() => openCardPurchases(c)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    openCardPurchases(c);
                }}
              >
                <div className="card-actions">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditCard(c);
                    }}
                    aria-label={`Editar cartão ${c.name}`}
                    title="Editar cartão"
                  >
                    ✎
                  </button>
                  <button
                    className="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCardToDelete(c);
                    }}
                    aria-label={`Excluir cartão ${c.name}`}
                    title="Excluir cartão"
                  >
                    🗑
                  </button>
                </div>
                <div className="card-top">
                  <span>
                    <small>{c.bank}</small>
                    <div className="card-name-line">
                      <h3>{c.name}</h3>
                      <p>•••• {c.lastFour}</p>
                    </div>
                  </span>
                </div>
                <div className="invoice-highlight">
                  <small>
                    Fechamento dia {c.closingDay} · Vencimento dia {c.dueDay}
                  </small>
                  <strong>{money(current?.totalCents ?? 0)}</strong>
                </div>
                <div className="limit-progress">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="limit-labels">
                  <span>
                    Utilizado<strong>{money(used)}</strong>
                  </span>
                  <span>
                    Disponível<strong>{money(available)}</strong>
                  </span>
                  <span>
                    Limite total<strong>{money(c.creditLimitCents)}</strong>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="section-title chart-section-title">
        <div>
          <p className="eyebrow">EVOLUÇÃO MENSAL (14 MESES)</p>
          <h3>Total de todos os cartões</h3>
        </div>
        <div className="chart-year-selector" aria-label="Seletor de ano das faturas">
          <button
            type="button"
            onClick={() => setChartYear((y) => y - 1)}
            aria-label="Ano anterior"
            title="Ano anterior"
          >
            ‹
          </button>
          <strong>{chartYear}</strong>
          <button
            type="button"
            onClick={() => setChartYear((y) => y + 1)}
            aria-label="Próximo ano"
            title="Próximo ano"
          >
            ›
          </button>
        </div>
      </div>
      <section
        className="cards-chart"
        aria-label={`Total mensal das faturas de todos os cartões no período de 14 meses em torno de ${chartYear}`}
      >
        <div className="chart-bars chart-bars-14">
          {fourteenMonthsTotals.map((item) => {
            const [y, m] = item.month.split("-");
            const shortMonths = [
              "",
              "Jan",
              "Fev",
              "Mar",
              "Abr",
              "Mai",
              "Jun",
              "Jul",
              "Ago",
              "Set",
              "Out",
              "Nov",
              "Dez",
            ];
            const label = item.isPrevYear
              ? `Dez/${y.slice(2)}`
              : item.isNextYear
                ? `Jan/${y.slice(2)}`
                : shortMonths[Number(m)] ?? m;

            return (
              <div
                className={`chart-column ${item.isSelected ? "chart-column-active" : ""} ${item.isPrevYear || item.isNextYear ? "chart-column-edge" : ""}`}
                key={item.month}
                onClick={() => onMonthChange?.(item.month)}
                role="button"
                tabIndex={0}
                title={`${formatMonth(item.month)}: ${money(item.total)}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    onMonthChange?.(item.month);
                }}
              >
                <strong>{item.total > 0 ? money(item.total) : "—"}</strong>
                <div className="chart-track">
                  <i
                    style={{
                      height:
                        item.total > 0
                          ? `${Math.max(8, (item.total / chartMax) * 100)}%`
                          : "3px",
                      opacity: item.total > 0 ? 1 : 0.25,
                    }}
                  />
                </div>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </section>
      {cardModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <button className="modal-close" onClick={() => setCardModal(false)}>
              ×
            </button>
            <p className="eyebrow">
              {editingCardId ? "EDITAR CARTÃO" : "NOVO CARTÃO"}
            </p>
            <h2>{editingCardId ? "Atualize o cartão" : "Dados do cartão"}</h2>
            <label>
              Apelido
              <input
                value={card.name}
                onChange={(e) => setCard({ ...card, name: e.target.value })}
                placeholder="Ex.: Nubank principal"
              />
            </label>
            <div className="field-row">
              <label>
                Banco
                <input
                  value={card.bank}
                  onChange={(e) => setCard({ ...card, bank: e.target.value })}
                />
              </label>
              <label>
                Últimos 4 dígitos
                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={card.lastFour}
                  onChange={(e) =>
                    setCard({ ...card, lastFour: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Limite
              <input
                inputMode="decimal"
                value={card.creditLimit}
                onChange={(e) =>
                  setCard({
                    ...card,
                    creditLimit: formatMoneyInput(e.target.value),
                  })
                }
              />
            </label>
            <div className="field-row">
              <label>
                Dia de fechamento
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={card.closingDay}
                  onChange={(e) =>
                    setCard({ ...card, closingDay: e.target.value })
                  }
                />
              </label>
              <label>
                Dia de vencimento
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={card.dueDay}
                  onChange={(e) => setCard({ ...card, dueDay: e.target.value })}
                />
              </label>
            </div>
            <fieldset className="card-color-picker">
              <legend>Cor do cartão</legend>
              <div>
                {[
                  { value: "green", label: "Verde" },
                  { value: "purple", label: "Roxo" },
                  { value: "coral", label: "Coral" },
                  { value: "lime", label: "Lima" },
                  { value: "orange", label: "Laranja" },
                  { value: "sky", label: "Azul claro" },
                  { value: "navy", label: "Azul escuro" },
                  { value: "red", label: "Vermelho" },
                  { value: "black", label: "Preto" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`${option.value} ${card.color === option.value ? "selected" : ""}`}
                    onClick={() => setCard({ ...card, color: option.value })}
                    aria-pressed={card.color === option.value}
                  >
                    <i />
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              className="primary wide"
              disabled={saving}
              onClick={() => void saveCard()}
            >
              {saving
                ? "Salvando…"
                : editingCardId
                  ? "Salvar alterações"
                  : "Cadastrar cartão"}
            </button>
          </div>
        </div>
      )}
      {selectedCard && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setSelectedCard(null)}
        >
          <div
            className="modal purchases-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setSelectedCard(null)}
            >
              ×
            </button>
            <p className="eyebrow">
              {selectedCard.bank} · •••• {selectedCard.lastFour}
            </p>
            <div className="purchase-title-row">
              <h2>
                Compras de {selectedCard.name} · {formatMonth(activeMonth)}
              </h2>
              <div className="purchase-sort" aria-label="Ordenar compras">
                {(["date", "value"] as const).map((field) => {
                  const active = purchaseSort.field === field;
                  return (
                    <button
                      key={field}
                      className={active ? "active" : ""}
                      onClick={() => togglePurchaseSort(field)}
                      aria-pressed={active}
                      aria-label={`Ordenar por ${field === "date" ? "data" : "valor"}`}
                    >
                      <span aria-hidden="true">
                        {field === "date" ? "▣" : "R$"}
                      </span>
                      {field === "date" ? "Data" : "Valor"}
                      {active && (
                        <b aria-hidden="true">
                          {purchaseSort.direction === "desc" ? "↓" : "↑"}
                        </b>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="purchase-list">
              {selectedCardPurchases.map((p) => {
                const isRefund = p.installmentCents < 0;
                return (
                  <article
                    key={p.id}
                    className={`purchase-item ${isRefund ? "refund-item" : ""}`}
                  >
                    <button
                      className="purchase-edit"
                      onClick={() => openEditPurchase(p)}
                      aria-label={`Editar ${p.description}`}
                    >
                      <span
                        className="purchase-icon"
                        aria-hidden="true"
                        style={{
                          backgroundColor: isRefund
                            ? "#dcfce7"
                            : `${CATEGORY_COLORS[p.category] || CATEGORY_COLORS.Outros}16`,
                        }}
                      >
                        {isRefund
                          ? "↩️"
                          : CATEGORY_ICONS[p.category] ||
                            CATEGORY_ICONS.Outros}
                      </span>
                      <div className="purchase-info">
                        <strong>{p.description}</strong>
                        <div>
                          <time dateTime={p.purchaseDate}>
                            {new Date(
                              p.purchaseDate + "T12:00:00Z",
                            ).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              timeZone: "UTC",
                            })}
                          </time>
                          <span
                            className={`purchase-category ${isRefund ? "refund-tag" : ""}`}
                          >
                            {isRefund ? "Estorno" : p.category}
                          </span>
                          <span className="purchase-installment">
                            ({p.currentInstallmentNumber}/{p.installmentCount})
                          </span>
                        </div>
                      </div>
                      <b
                        className={`purchase-amount ${isRefund ? "refund" : ""}`}
                      >
                        {money(p.installmentCents)}
                      </b>
                    </button>
                    <button
                      className="purchase-delete"
                      onClick={() => setPurchaseToDelete(p)}
                      aria-label={`Excluir ${p.description}`}
                      title="Excluir compra"
                    >
                      🗑
                    </button>
                  </article>
                );
              })}
              {!selectedCardPurchases.length && (
                <div className="agenda-empty">
                  <strong>Nenhuma compra nesta fatura.</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {purchaseModal && purchaseForm()}
      <ConfirmDialog
        open={Boolean(purchaseToDelete)}
        title="Excluir compra?"
        message={
          purchaseToDelete
            ? `A compra “${purchaseToDelete.description}” e todas as parcelas serão removidas. As faturas serão recalculadas.`
            : ""
        }
        confirmLabel="Excluir compra"
        danger
        onCancel={() => setPurchaseToDelete(null)}
        onConfirm={() =>
          purchaseToDelete && void removePurchase(purchaseToDelete)
        }
      />
      <ConfirmDialog
        open={Boolean(cardToDelete)}
        title="Excluir cartão?"
        message={
          cardToDelete
            ? `O cartão “${cardToDelete.name}” será excluído junto com todas as compras, parcelas, faturas, dívidas e lançamentos vinculados. Esta ação não pode ser desfeita.`
            : ""
        }
        confirmLabel="Excluir tudo"
        danger
        onCancel={() => setCardToDelete(null)}
        onConfirm={() => cardToDelete && void removeCard(cardToDelete)}
      />
    </>
  );
}
