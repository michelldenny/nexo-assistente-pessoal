"use client";
import { useEffect, useMemo, useState } from "react";
import { TRANSACTION_CATEGORIES } from "./categories";
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
type Data = {
  cards: Card[];
  invoices: Invoice[];
  debts: Debt[];
  purchases: Purchase[];
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
  });
  const [cardModal, setCardModal] = useState(false),
    [purchaseModal, setPurchaseModal] = useState(false),
    [selectedCard, setSelectedCard] = useState<Card | null>(null),
    [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null),
    [cardToDelete, setCardToDelete] = useState<Card | null>(null),
    [editingCardId, setEditingCardId] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [debtSort, setDebtSort] = useState<DebtSort>("newest");
  const [card, setCard] = useState(emptyCard),
    [purchase, setPurchase] = useState(emptyPurchase);
  const cardMap = useMemo(
    () => Object.fromEntries(data.cards.map((c) => [c.id, c])),
    [data.cards],
  );
  const sortedDebts = useMemo(() => {
    const dateKey = (debt: Debt) =>
      debt.startDate || `${debt.startMonth || "0000-00"}-01`;
    const balance = (debt: Debt) =>
      Math.max(0, debt.totalCents - debt.paidCents);
    const progress = (debt: Debt) =>
      debt.installmentCount ? debt.paidInstallments / debt.installmentCount : 0;
    return [...data.debts].sort((a, b) => {
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
  }, [data.debts, debtSort]);
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
      await load();
      setEditingCardId(null);
      onNotice(editingCardId ? "Cartão atualizado." : "Cartão cadastrado.");
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  async function removeCard(item: Card) {
    const response = await fetch(`/api/cards?cardId=${item.id}`, {
      method: "DELETE",
    });
    const body = await response.json();
    if (!response.ok)
      return onNotice(body.error || "Não foi possível excluir o cartão.");
    setSelectedCard(null);
    setCardToDelete(null);
    await load();
    onNotice("Cartão e todos os dados vinculados foram excluídos.");
  }
  async function createPurchase() {
    setSaving(true);
    try {
      const enteredCents = parseMoneyInput(purchase.total),
        installmentCount = Number(purchase.installmentCount),
        totalCents =
          purchase.valueMode === "installment"
            ? enteredCents * installmentCount
            : enteredCents,
        r = await fetch("/api/cards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create_purchase",
            ...purchase,
            cardId: Number(purchase.cardId),
            totalCents,
            installmentCount,
          }),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setPurchaseModal(false);
      setPurchase(emptyPurchase);
      await load();
      onNotice(
        Number(purchase.installmentCount) > 1
          ? "Compra adicionada às Dívidas."
          : "Compra adicionada à fatura.",
      );
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  async function removePurchase(item: Purchase) {
    const response = await fetch(`/api/cards?purchaseId=${item.id}`, {
      method: "DELETE",
    });
    const body = await response.json();
    if (!response.ok)
      return onNotice(body.error || "Não foi possível excluir.");
    await load();
    setPurchaseToDelete(null);
    onNotice("Compra e parcelas excluídas. As faturas foram recalculadas.");
  }
  function purchaseForm() {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <button
            className="modal-close"
            onClick={() => setPurchaseModal(false)}
          >
            ×
          </button>
          <p className="eyebrow">NOVA COMPRA</p>
          <h2>Adicionar à fatura</h2>
          <label>
            Cartão
            <select
              value={purchase.cardId}
              onChange={(e) =>
                setPurchase({ ...purchase, cardId: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {data.cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.lastFour}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descrição
            <input
              value={purchase.description}
              onChange={(e) =>
                setPurchase({ ...purchase, description: e.target.value })
              }
            />
          </label>
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
            onClick={() => void createPurchase()}
          >
            Adicionar compra
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
            onClick={() => setPurchaseModal(true)}
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
          <label className="debt-sort">
            <span>Ordenar por</span>
            <select
              value={debtSort}
              onChange={(event) => setDebtSort(event.target.value as DebtSort)}
            >
              <option value="newest">Mais atuais</option>
              <option value="oldest">Mais antigas</option>
              <option value="balance_desc">Saldo devedor: maior</option>
              <option value="balance_asc">Saldo devedor: menor</option>
              <option value="progress_desc">% paga: maior</option>
              <option value="progress_asc">% paga: menor</option>
              <option value="installment_desc">Valor da parcela: maior</option>
              <option value="installment_asc">Valor da parcela: menor</option>
            </select>
          </label>
        </div>
        <div className="debt-grid">
          {data.debts.length ? (
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
              <strong>Nenhuma dívida parcelada.</strong>
              <small>Compras em mais de 1x aparecerão aqui.</small>
            </div>
          )}
        </div>
        {purchaseModal && purchaseForm()}
      </>
    );
  }
  const monthlyTotals = Object.entries(
    data.invoices
      .filter((invoice) => invoice.totalCents > 0)
      .reduce<Record<string, number>>((totals, invoice) => {
        totals[invoice.referenceMonth] =
          (totals[invoice.referenceMonth] ?? 0) + invoice.totalCents;
        return totals;
      }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));
  const chartMax = Math.max(...monthlyTotals.map(([, total]) => total), 1);
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
            disabled={!data.cards.length}
            onClick={() => setPurchaseModal(true)}
          >
            ＋ Nova compra
          </button>
        </div>
      </div>
      {!data.cards.length ? (
        <div className="agenda-empty">
          <strong>Cadastre seu primeiro cartão.</strong>
          <small>Informe limite, fechamento e vencimento.</small>
          <button onClick={openNewCard}>Cadastrar cartão</button>
        </div>
      ) : (
        <div className="cards-grid">
          {data.cards.map((c) => {
            const openInvoices = data.invoices.filter(
                (i) =>
                  i.cardId === c.id && i.status === "open" && i.totalCents > 0,
              ),
              used = openInvoices.reduce((s, i) => s + i.totalCents, 0),
              current = [...openInvoices].sort((a, b) =>
                a.referenceMonth.localeCompare(b.referenceMonth),
              )[0],
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
                onClick={() => setSelectedCard(c)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    setSelectedCard(c);
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
                    Fatura atual{" "}
                    {current ? formatMonth(current.referenceMonth) : ""}
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
                <small className="card-hint">Clique para ver as compras</small>
              </article>
            );
          })}
        </div>
      )}
      <div className="section-title">
        <div>
          <p className="eyebrow">EVOLUÇÃO MENSAL</p>
          <h3>Total de todos os cartões</h3>
        </div>
      </div>
      <section
        className="cards-chart"
        aria-label="Total mensal das faturas de todos os cartões"
      >
        {monthlyTotals.length ? (
          <div className="chart-bars">
            {monthlyTotals.map(([chartMonth, total]) => (
              <div className="chart-column" key={chartMonth}>
                <strong>{money(total)}</strong>
                <div className="chart-track">
                  <i
                    style={{
                      height: `${Math.max(7, (total / chartMax) * 100)}%`,
                    }}
                  />
                </div>
                <span>{formatMonth(chartMonth)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="agenda-empty">
            <strong>Ainda não há valores para o gráfico.</strong>
          </div>
        )}
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
            <h2>Compras de {selectedCard.name}</h2>
            <div className="purchase-list">
              {data.purchases
                .filter((p) => p.cardId === selectedCard.id)
                .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
                .map((p) => {
                  const isInstallment = p.installmentCount > 1;
                  const installmentValue = isInstallment
                    ? Math.round(p.totalCents / p.installmentCount)
                    : p.totalCents;
                  return (
                    <article key={p.id} className="purchase-item">
                      <div className="purchase-item-info">
                        <strong>{p.description}</strong>
                        <small>
                          {p.category} ·{" "}
                          {new Date(
                            p.purchaseDate + "T12:00:00Z",
                          ).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                        </small>
                      </div>
                      <span className="purchase-badge">
                        {isInstallment
                          ? `${p.installmentCount}x parcelas`
                          : "À vista"}
                      </span>
                      <div className="purchase-amount-col">
                        <b>{money(installmentValue)}</b>
                        <small>
                          {isInstallment
                            ? `valor da parcela (Total: ${money(p.totalCents)})`
                            : "valor total"}
                        </small>
                      </div>
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
              {!data.purchases.some((p) => p.cardId === selectedCard.id) && (
                <div className="agenda-empty">
                  <strong>Nenhuma compra neste cartão.</strong>
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
