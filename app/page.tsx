"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AgendaView, { type EventDraft } from "./AgendaView";
import {
  CATEGORY_COLORS,
  INCOME_CATEGORIES,
  TRANSACTION_CATEGORIES,
} from "./categories";
import CardsView from "./CardsView";
import ConfirmDialog from "./ConfirmDialog";
import { formatMoneyInput, formatMonth, parseMoneyInput } from "./ui-format";

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
type Attachment = { name: string; mimeType: string; data: string };
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const emptyDraft = (): Draft => ({
  kind: "expense",
  description: "",
  category: "Outros",
  amount: "0,00",
  occurredOn: today(),
  recurring: false,
  recurrenceDay: String(new Date().getDate()),
  recurrenceEndMonth: "",
});
const monthLabel = formatMonth;
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
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/\s+de\s+/gi, " ");

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState(
    "Posso registrar lançamentos, consultar seus gastos e explicar o que mudou no seu mês.",
  );
  const [tab, setTab] = useState("Visão geral");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [agendaDraft, setAgendaDraft] = useState<EventDraft | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [entryToDelete, setEntryToDelete] = useState<Entry | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadEntries(month, controller.signal);
      void loadInsights(month, controller.signal);
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [month]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 1000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  async function loadInsights(requestedMonth = month, signal?: AbortSignal) {
    try {
      const response = await fetch(`/api/insights?month=${requestedMonth}`, {
        cache: "no-store",
        signal,
      });
      if (response.ok && !signal?.aborted)
        setInsights((await response.json()).messages ?? []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  async function loadEntries(requestedMonth = month, signal?: AbortSignal) {
    setLoading(true);
    try {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(
            `/api/transactions?month=${requestedMonth}`,
            { cache: "no-store", signal },
          );
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          if (!signal?.aborted) setEntries(body.transactions);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          lastError =
            error instanceof Error ? error : new Error("Falha ao carregar.");
        }
      }
      throw lastError;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("Não foi possível carregar seus dados agora.");
    } finally {
      if (!signal?.aborted) setLoading(false);
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
    const amountCents = parseMoneyInput(draft.amount);
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

  async function removeEntry(
    entry: Entry,
    scope: "one" | "all" | "future" = "one",
  ) {
    const response = await fetch(
      `/api/transactions?id=${entry.id}&scope=${scope}`,
      {
        method: "DELETE",
      },
    );
    if (response.ok) {
      setEntries((current) => current.filter((e) => e.id !== entry.id));
      setNotice(
        scope === "all"
          ? "Todas as recorrências deste lançamento foram excluídas."
          : scope === "future"
            ? "Este lançamento e todas as recorrências futuras foram excluídos."
            : "Lançamento excluído.",
      );
      setEntryToDelete(null);
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
    if (!cleaned && !attachment) return;
    setMessage("");
    setReply("Pensando…");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: cleaned, attachment }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setReply(body.message);
      setAttachment(null);
      if (body.type === "transaction_draft") {
        setDraft({ ...emptyDraft(), ...body.draft });
        setEditingId(null);
        setModalOpen(true);
      }
      if (
        body.type === "purchase_created" ||
        body.type === "purchases_created"
      ) {
        await loadEntries();
        await loadInsights();
        setNotice(
          body.type === "purchases_created"
            ? `${body.count} transações da fatura foram importadas.`
            : "Compra adicionada ao cartão e à fatura correspondente.",
        );
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

  async function attachFile(file?: File) {
    if (!file) return;
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/csv",
    ];
    if (!allowed.includes(file.type))
      return setNotice("Use uma imagem, PDF, TXT ou CSV.");
    if (file.size > 3_500_000)
      return setNotice("O arquivo deve ter no máximo 3,5 MB.");
    setAttachmentBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      setAttachment({
        name: file.name,
        mimeType: file.type,
        data: dataUrl.split(",")[1],
      });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível anexar.",
      );
    } finally {
      setAttachmentBusy(false);
    }
  }

  return (
    <main
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="brand" title="Nexo Assistente Pessoal">
            <span className="brand-mark">n</span>
            {!sidebarCollapsed && <span>nexo</span>}
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            title={
              sidebarCollapsed
                ? "Expandir menu lateral"
                : "Recolher menu lateral"
            }
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
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
              title={sidebarCollapsed ? item : undefined}
            >
              <span className="nav-icon">
                {["⌂", "↗", "✦", "□", "▣", "◔"][index]}
              </span>
              {!sidebarCollapsed && <span className="nav-text">{item}</span>}
            </button>
          ))}
          {!sidebarCollapsed && <p className="nav-label">EM BREVE</p>}
          <button
            className="nav-item muted"
            disabled
            title={sidebarCollapsed ? "Documentos (Em breve)" : undefined}
          >
            <span className="nav-icon">○</span>
            {!sidebarCollapsed && <span className="nav-text">Documentos</span>}
          </button>
        </nav>
        <div
          className="profile"
          title={sidebarCollapsed ? "Minha conta - Espaço privado" : undefined}
        >
          <div className="avatar">MR</div>
          {!sidebarCollapsed && (
            <>
              <div>
                <strong>Minha conta</strong>
                <small>Espaço privado</small>
              </div>
              <button aria-label="Mais opções">•••</button>
            </>
          )}
        </div>
      </aside>

      <section className="workspace">
        {tab !== "Dívidas" && (
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
              {tab !== "Agenda" && tab !== "Cartões" && (
                <button
                  className="primary"
                  onClick={() => openNew({ occurredOn: `${month}-01` })}
                >
                  <span>＋</span>Novo lançamento
                </button>
              )}
            </div>
          </header>
        )}
        {notice && (
          <div className="notice" role="status">
            <span className="notice-icon">✓</span>
            <span className="notice-text">{notice}</span>
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
            selectedMonth={month}
            onMonthChange={setMonth}
          />
        ) : tab === "Cartões" || tab === "Dívidas" ? (
          <CardsView
            mode={tab === "Cartões" ? "cards" : "debts"}
            onNotice={setNotice}
            selectedMonth={month}
            onMonthChange={setMonth}
          />
        ) : (
          <div
            className={`content-grid ${tab === "Assistente" ? "assistant-view" : "finance-view"}`}
          >
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
                      <div
                        className={`transaction ${entry.kind}`}
                        key={entry.id}
                      >
                        <div
                          className={`transaction-icon ${entry.kind}`}
                          style={{
                            background:
                              entry.kind === "income"
                                ? "#e8f7ee"
                                : `${CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS.Outros}18`,
                            color:
                              entry.kind === "income"
                                ? "#168565"
                                : (CATEGORY_COLORS[entry.category] ??
                                  CATEGORY_COLORS.Outros),
                          }}
                        >
                          {entry.kind === "income" ? "↓" : "↑"}
                        </div>
                        <div className="transaction-copy">
                          <div className="transaction-header-line">
                            <strong>{entry.description}</strong>
                            <span className={`kind-pill ${entry.kind}`}>
                              {entry.kind === "income" ? "Receita" : "Despesa"}
                            </span>
                          </div>
                          <small>
                            {entry.category} · {displayDate(entry.occurredOn)}
                            {entry.source === "assistant"
                              ? " · via assistente"
                              : ""}
                          </small>
                        </div>
                        <strong className={`transaction-amount ${entry.kind}`}>
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
                            onClick={() => setEntryToDelete(entry)}
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
              <div
                className={`composer ${attachment ? "has-attachment" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void attachFile(event.dataTransfer.files[0]);
                }}
              >
                {attachment && (
                  <div className="attachment-chip">
                    <span>
                      {attachment.mimeType.startsWith("image/")
                        ? "▧"
                        : attachment.mimeType === "application/pdf"
                          ? "PDF"
                          : "TXT"}
                    </span>
                    <div>
                      <strong>{attachment.name}</strong>
                      <small>Pronto para analisar</small>
                    </div>
                    <button
                      onClick={() => setAttachment(null)}
                      aria-label="Remover anexo"
                    >
                      ×
                    </button>
                  </div>
                )}
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
                  <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,text/csv,.csv,.txt,.pdf"
                    onChange={(event) => {
                      void attachFile(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Anexar arquivo"
                    title="Anexar imagem, PDF, TXT ou CSV"
                    disabled={attachmentBusy}
                  >
                    {attachmentBusy ? "…" : "＋"}
                  </button>
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
                    setDraft((d) => ({
                      ...d,
                      amount: formatMoneyInput(e.target.value),
                    }))
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
      <ConfirmDialog
        open={Boolean(entryToDelete && !entryToDelete.recurringRuleId)}
        title="Excluir lançamento?"
        message={
          entryToDelete
            ? `O lançamento “${entryToDelete.description}” será removido permanentemente.`
            : ""
        }
        confirmLabel="Excluir"
        danger
        onCancel={() => setEntryToDelete(null)}
        onConfirm={() => entryToDelete && void removeEntry(entryToDelete)}
      />
      {entryToDelete?.recurringRuleId && (
        <div
          className="modal-backdrop system-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setEntryToDelete(null)}
        >
          <div
            className="system-dialog recurrence-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-symbol danger">!</div>
            <h2>Excluir lançamento recorrente?</h2>
            <p>
              Deseja excluir apenas o lançamento de{" "}
              <strong>“{entryToDelete.description}”</strong> deste mês ou
              excluir <strong>todas as recorrências</strong> vinculadas a esta
              regra?
            </p>
            <div className="recurrence-delete-actions">
              <button onClick={() => setEntryToDelete(null)}>Cancelar</button>
              <button onClick={() => void removeEntry(entryToDelete, "one")}>
                Excluir apenas esta ocorrência
              </button>
              <button
                className="dialog-danger"
                onClick={() => void removeEntry(entryToDelete, "all")}
              >
                Excluir todas as recorrências
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de navegação inferior fixa para dispositivos móveis */}
      <nav className="mobile-bottom-nav" aria-label="Navegação móvel">
        {[
          { name: "Visão geral", icon: "⌂", label: "Início" },
          { name: "Financeiro", icon: "↗", label: "Finanças" },
          { name: "Assistente", icon: "✦", label: "Nexo" },
          { name: "Agenda", icon: "□", label: "Agenda" },
          { name: "Cartões", icon: "▣", label: "Cartões" },
          { name: "Dívidas", icon: "◔", label: "Dívidas" },
        ].map((item) => (
          <button
            key={item.name}
            className={`bottom-nav-item ${tab === item.name ? "active" : ""}`}
            onClick={() => setTab(item.name)}
            aria-label={item.name}
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
