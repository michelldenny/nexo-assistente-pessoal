"use client";

import { useEffect, useMemo, useState } from "react";
import AgendaView, { type EventDraft } from "./AgendaView";
import {
  CATEGORY_COLORS,
  INCOME_CATEGORIES,
  TRANSACTION_CATEGORIES,
} from "./categories";
import CardsView from "./CardsView";

type Entry = {
  id: number;
  description: string;
  category: string;
  occurredOn: string;
  amountCents: number;
  kind: "expense" | "income";
  source: "manual" | "assistant";
  status: "pending" | "settled";
  recurringRuleId?: number | null;
  invoiceId?: number | null;
};

type Draft = {
  kind: "expense" | "income";
  description: string;
  category: string;
  amount: string;
  occurredOn: string;
  recurring: boolean;
  recurrenceDay: string;
  recurrenceEndMonth: string;
};
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const emptyDraft = (): Draft => ({
  kind: "expense",
  description: "",
  category: "Outros",
  amount: "",
  occurredOn: today(),
  recurring: false,
  recurrenceDay: String(new Date().getDate()),
  recurrenceEndMonth: "",
});
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
const moveMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number),
    d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Math.abs(cents) / 100,
  );
const displayDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState(
    "Posso registrar lançamentos, consultar seus gastos e explicar o que mudou no seu mês.",
  );
  const [tab, setTab] = useState("Visão geral");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [agendaDraft, setAgendaDraft] = useState<EventDraft | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [insights, setInsights] = useState<string[]>([]);

  useEffect(() => {
    void loadEntries();
    void loadInsights();
  }, [month]);
  async function loadInsights() {
    const response = await fetch(`/api/insights?month=${month}`, {
      cache: "no-store",
    });
    if (response.ok) setInsights((await response.json()).messages ?? []);
  }
  async function loadEntries() {
    try {
      const response = await fetch(`/api/transactions?month=${month}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEntries(body.transactions);
    } catch {
      setNotice("Não foi possível carregar seus dados agora.");
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(
    () => ({
      income: entries
        .filter((e) => e.kind === "income")
        .reduce((sum, e) => sum + e.amountCents, 0),
      expense: entries
        .filter((e) => e.kind === "expense")
        .reduce((sum, e) => sum + e.amountCents, 0),
    }),
    [entries],
  );

  function openNew(prefill?: Partial<Draft>) {
    setEditingId(null);
    setDraft({ ...emptyDraft(), ...prefill });
    setModalOpen(true);
  }

  function openEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraft({
      kind: entry.kind,
      description: entry.description,
      category: entry.category,
      amount: (entry.amountCents / 100).toFixed(2).replace(".", ","),
      occurredOn: entry.occurredOn,
      recurring: false,
      recurrenceDay: entry.occurredOn.slice(8, 10),
      recurrenceEndMonth: "",
    });
    setModalOpen(true);
  }

  async function saveDraft(source: "manual" | "assistant" = "manual") {
    const amountCents = Math.round(
      Number(draft.amount.replace(".", "").replace(",", ".")) * 100,
    );
    if (
      !draft.description.trim() ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0
    ) {
      setNotice("Preencha descrição e valor corretamente.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/transactions", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editingId, ...draft, amountCents, source }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEntries((current) =>
        editingId
          ? current.map((e) => (e.id === editingId ? body.transaction : e))
          : [body.transaction, ...current],
      );
      setModalOpen(false);
      setNotice(editingId ? "Lançamento atualizado." : "Lançamento salvo.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry: Entry) {
    if (!window.confirm(`Excluir “${entry.description}”?`)) return;
    const response = await fetch(`/api/transactions?id=${entry.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setEntries((current) => current.filter((e) => e.id !== entry.id));
      setNotice("Lançamento excluído.");
    } else setNotice("Não foi possível excluir.");
  }

  async function toggleStatus(entry: Entry) {
    const response = await fetch("/api/transactions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: entry.id, action: "toggle_status" }),
    });
    const body = await response.json();
    if (response.ok) {
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? body.transaction : item)),
      );
      setNotice(
        entry.status === "settled"
          ? "Status reaberto."
          : entry.kind === "income"
            ? "Receita recebida."
            : "Despesa paga.",
      );
    } else setNotice(body.error || "Não foi possível alterar o status.");
  }

  function statusLabel(entry: Entry) {
    if (entry.status === "settled")
      return entry.kind === "income" ? "Recebido" : "Pago";
    const overdue = entry.occurredOn < today();
    return entry.kind === "income"
      ? overdue
        ? "Atrasado"
        : "A receber"
      : overdue
        ? "Vencido"
        : "A Pagar";
  }

  async function sendMessage(text = message) {
    const cleaned = text.trim();
    if (!cleaned) return;
    setMessage("");
    setReply("Pensando…");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: cleaned }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setReply(body.message);
      if (body.type === "transaction_draft") {
        setDraft({ ...emptyDraft(), ...body.draft });
        setEditingId(null);
        setModalOpen(true);
      }
      if (body.type === "purchase_created") {
        await loadEntries();
        await loadInsights();
        setNotice("Compra adicionada ao cartão e à fatura correspondente.");
      }
      if (body.type === "event_draft") {
        setAgendaDraft(body.draft);
        setTab("Agenda");
      }
    } catch (error) {
      setReply(
        error instanceof Error
          ? `Não consegui responder: ${error.message}`
          : "Não consegui responder agora.",
      );
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">n</span>
          <span>nexo</span>
        </div>
        <nav aria-label="Navegação principal">
          {[
            "Visão geral",
            "Financeiro",
            "Assistente",
            "Agenda",
            "Cartões",
            "Dívidas",
          ].map((item, index) => (
            <button
              key={item}
              className={tab === item ? "nav-item active" : "nav-item"}
              onClick={() => setTab(item)}
            >
              <span>{["⌂", "↗", "✦", "□", "▣", "◔"][index]}</span>
              {item}
            </button>
          ))}
          <p className="nav-label">EM BREVE</p>
          <button className="nav-item muted" disabled>
            <span>○</span>Documentos
          </button>
        </nav>
        <div className="profile">
          <div className="avatar">MR</div>
          <div>
            <strong>Minha conta</strong>
            <small>Espaço privado</small>
          </div>
          <button aria-label="Mais opções">•••</button>
        </div>
      </aside>

      <section className="workspace">
        {!["Agenda", "Cartões", "Dívidas"].includes(tab) && (
          <header className="topbar">
            <div>
              <p className="eyebrow">SEU PAINEL PESSOAL</p>
              <h1>{tab === "Visão geral" ? "Bom dia, Michell." : tab}</h1>
            </div>
            <div className="top-actions">
              <div className="month-selector">
                <button
                  onClick={() => setMonth(moveMonth(month, -1))}
                  aria-label="Mês anterior"
                >
                  ‹
                </button>
                <strong>{monthLabel(month)}</strong>
                <button
                  onClick={() => setMonth(moveMonth(month, 1))}
                  aria-label="Próximo mês"
                >
                  ›
                </button>
              </div>
              <button
                className="primary"
                onClick={() => openNew({ occurredOn: `${month}-01` })}
              >
                <span>＋</span>Novo lançamento
              </button>
            </div>
          </header>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}

        {tab === "Agenda" ? (
          <AgendaView
            onNotice={setNotice}
            pendingDraft={agendaDraft}
            onDraftOpened={() => setAgendaDraft(null)}
          />
        ) : tab === "Cartões" || tab === "Dívidas" ? (
          <CardsView
            mode={tab === "Cartões" ? "cards" : "debts"}
            onNotice={setNotice}
          />
        ) : (
          <div className="content-grid">
            <section className="main-column">
              <article className="balance-card">
                <div className="balance-head">
                  <div>
                    <p>Saldo projetado de {monthLabel(month)}</p>
                    <h2>{money(totals.income - totals.expense)}</h2>
                  </div>
                  <span className="status-pill">● Visão mensal</span>
                </div>
                <div className="mini-stats">
                  <div>
                    <span className="dot income" />
                    Receitas<strong>{money(totals.income)}</strong>
                  </div>
                  <div>
                    <span className="dot expense" />
                    Despesas<strong>{money(totals.expense)}</strong>
                  </div>
                  <div
                    className="spark-bars"
                    aria-label="Movimento ilustrativo"
                  >
                    {[38, 52, 44, 67, 58, 76, 49, 86, 64, 74, 92, 81].map(
                      (h, i) => (
                        <i key={i} style={{ height: `${h}%` }} />
                      ),
                    )}
                  </div>
                </div>
              </article>

              <div className="section-title">
                <div>
                  <p className="eyebrow">MOVIMENTAÇÃO</p>
                  <h3>
                    {tab === "Financeiro"
                      ? "Todos os lançamentos"
                      : "Últimos lançamentos"}
                  </h3>
                </div>
                <button
                  onClick={() =>
                    setTab(tab === "Financeiro" ? "Visão geral" : "Financeiro")
                  }
                >
                  {tab === "Financeiro" ? "Ver resumo" : "Ver todos"} →
                </button>
              </div>
              <div className="transactions">
                {loading ? (
                  <div className="empty-state">
                    Carregando seus lançamentos…
                  </div>
                ) : entries.length === 0 ? (
                  <div className="empty-state">
                    <strong>Seu financeiro começa aqui.</strong>
                    <span>
                      Registre a primeira receita ou despesa pelo botão acima ou
                      pelo assistente.
                    </span>
                    <button onClick={() => openNew()}>
                      Criar primeiro lançamento
                    </button>
                  </div>
                ) : (
                  entries
                    .slice(0, tab === "Financeiro" ? 200 : 5)
                    .map((entry) => (
                      <div className="transaction" key={entry.id}>
                        <div
                          className="transaction-icon"
                          style={{
                            background: `${CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS.Outros}18`,
                            color:
                              CATEGORY_COLORS[entry.category] ??
                              CATEGORY_COLORS.Outros,
                          }}
                        >
                          {entry.description.charAt(0).toUpperCase()}
                        </div>
                        <div className="transaction-copy">
                          <strong>{entry.description}</strong>
                          <small>
                            {entry.category} · {displayDate(entry.occurredOn)}
                            {entry.source === "assistant"
                              ? " · via assistente"
                              : ""}
                          </small>
                        </div>
                        <strong className={entry.kind}>
                          {entry.kind === "income" ? "+ " : "− "}
                          {money(entry.amountCents)}
                        </strong>
                        <button
                          className={`entry-status ${entry.status} ${entry.kind}`}
                          onClick={() => void toggleStatus(entry)}
                        >
                          {statusLabel(entry)}
                        </button>
                        <div className="row-actions">
                          <button
                            className="icon-action"
                            onClick={() => openEdit(entry)}
                            aria-label={`Editar ${entry.description}`}
                            title="Editar"
                          >
                            ✎
                          </button>
                          <button
                            className="danger icon-action"
                            onClick={() => void removeEntry(entry)}
                            aria-label={`Excluir ${entry.description}`}
                            title="Excluir"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </section>

            <aside className="assistant-card">
              <div className="assistant-head">
                <div className="assistant-orb">✦</div>
                <div>
                  <strong>Assistente Nexo</strong>
                  <small>
                    <span>●</span> Pronto para ajudar
                  </small>
                </div>
                <button aria-label="Menu do assistente">•••</button>
              </div>
              <div className="conversation">
                <p className="assistant-label">NEXO · AGORA</p>
                <div className="bubble">{reply}</div>
                <div
                  className="insight-list"
                  aria-label="Análises do assistente"
                >
                  {insights.map((insight) => (
                    <div className="insight-bubble" key={insight}>
                      <span>✦</span>
                      <p>{insight}</p>
                    </div>
                  ))}
                </div>
                <div className="suggestions">
                  <button
                    onClick={() => void sendMessage("O que tenho na agenda?")}
                  >
                    Consultar minha agenda
                  </button>
                  <button
                    onClick={() => setMessage("Marque dentista sexta às 14h")}
                  >
                    Criar compromisso
                  </button>
                  <button onClick={() => setMessage("Gastei 89,90 no mercado")}>
                    Registrar despesa
                  </button>
                </div>
              </div>
              <div className="composer">
                <textarea
                  aria-label="Mensagem para o assistente"
                  placeholder="Fale com o Nexo..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                <div>
                  <button aria-label="Anexar arquivo">＋</button>
                  <span>Enter para enviar</span>
                  <button
                    className="send"
                    onClick={() => void sendMessage()}
                    aria-label="Enviar mensagem"
                  >
                    ↑
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </section>

      {modalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setModalOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setModalOpen(false)}>
              ×
            </button>
            <p className="eyebrow">
              {editingId ? "EDITAR LANÇAMENTO" : "NOVO LANÇAMENTO"}
            </p>
            <h2 id="modal-title">
              {editingId ? "Ajuste os dados" : "Registre do seu jeito"}
            </h2>
            <div className="type-toggle">
              <button
                className={draft.kind === "expense" ? "selected" : ""}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    kind: "expense",
                    category: "Outros",
                  }))
                }
              >
                Despesa
              </button>
              <button
                className={draft.kind === "income" ? "selected" : ""}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    kind: "income",
                    category: "Salário",
                  }))
                }
              >
                Receita
              </button>
            </div>
            <label>
              Descrição
              <input
                autoFocus
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder={
                  draft.kind === "income"
                    ? "Ex.: Pagamento mensal"
                    : "Ex.: Mercado"
                }
              />
            </label>
            <div className="field-row">
              <label>
                Valor
                <input
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, amount: e.target.value }))
                  }
                  placeholder="0,00"
                />
              </label>
              <label>
                Data
                <input
                  type="date"
                  value={draft.occurredOn}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, occurredOn: e.target.value }))
                  }
                />
              </label>
            </div>
            <label>
              Categoria
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                {(draft.kind === "income"
                  ? INCOME_CATEGORIES
                  : TRANSACTION_CATEGORIES
                ).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {!editingId && (
              <div className="recurrence-box">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.recurring}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        recurring: e.target.checked,
                        recurrenceDay: d.occurredOn.slice(8, 10),
                      }))
                    }
                  />
                  Repetir este lançamento todo mês
                </label>
                {draft.recurring && (
                  <div className="field-row">
                    <label>
                      Dia do mês
                      <input
                        type="number"
                        min="1"
                        max="28"
                        value={draft.recurrenceDay}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            recurrenceDay: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Repetir até
                      <input
                        type="month"
                        value={draft.recurrenceEndMonth}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            recurrenceEndMonth: e.target.value,
                          }))
                        }
                      />
                      <small>Opcional</small>
                    </label>
                  </div>
                )}
              </div>
            )}
            <button
              className="primary wide"
              disabled={saving}
              onClick={() =>
                void saveDraft(
                  editingId
                    ? "manual"
                    : reply.includes("Revise e confirme")
                      ? "assistant"
                      : "manual",
                )
              }
            >
              {saving
                ? "Salvando…"
                : editingId
                  ? "Salvar alterações"
                  : "Salvar lançamento"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
