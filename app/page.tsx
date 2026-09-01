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
import ImportBackupModal from "./ImportBackupModal";
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

type CardExpense = {
  id: number;
  installmentId: number;
  purchaseId: number;
  cardId: number;
  cardName: string;
  cardColor: string;
  description: string;
  category: string;
  amountCents: number;
  purchaseDate: string;
  installmentNumber: number;
  installmentCount: number;
  status: "pending" | "paid";
};

type TransactionSort = {
  field: "date" | "value";
  direction: "asc" | "desc";
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
  const [importOpen, setImportOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [cardExpenses, setCardExpenses] = useState<CardExpense[]>([]);
  const [transactionSort, setTransactionSort] = useState<TransactionSort>({
    field: "date",
    direction: "desc",
  });
  const speechBaseTextRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const [monthlyCashflow, setMonthlyCashflow] = useState<
    Record<string, { incomeCents: number; expenseCents: number }>
  >({});

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
          if (!signal?.aborted) {
            setEntries(body.transactions ?? []);
            setCardExpenses(body.cardExpenses ?? []);
            if (body.monthlyCashflow) {
              setMonthlyCashflow(body.monthlyCashflow);
            }
          }
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

  const categoryExpenses = useMemo(() => {
    // Transações normais de despesa (exclui faturas agrupadas para evitar duplicidade com os itens reais do cartão)
    const normalExpenses = entries.filter(
      (e) => e.kind === "expense" && !e.invoiceId,
    );

    const grouped: Record<
      string,
      {
        totalCents: number;
        count: number;
        entries: Entry[];
        cardExpenses: CardExpense[];
      }
    > = {};

    for (const entry of normalExpenses) {
      const cat = entry.category || "Outros";
      if (!grouped[cat]) {
        grouped[cat] = {
          totalCents: 0,
          count: 0,
          entries: [],
          cardExpenses: [],
        };
      }
      grouped[cat].totalCents += entry.amountCents;
      grouped[cat].count += 1;
      grouped[cat].entries.push(entry);
    }

    // Se houver transação de fatura mas nenhum cardExpense detalhado retornado (fallback)
    if (cardExpenses.length === 0) {
      const invoiceExpenses = entries.filter(
        (e) => e.kind === "expense" && e.invoiceId,
      );
      for (const entry of invoiceExpenses) {
        const cat = entry.category || "Outros";
        if (!grouped[cat]) {
          grouped[cat] = {
            totalCents: 0,
            count: 0,
            entries: [],
            cardExpenses: [],
          };
        }
        grouped[cat].totalCents += entry.amountCents;
        grouped[cat].count += 1;
        grouped[cat].entries.push(entry);
      }
    }

    // Adiciona os itens comprados nos cartões de crédito para este mês
    for (const cExp of cardExpenses) {
      const cat = cExp.category || "Outros";
      if (!grouped[cat]) {
        grouped[cat] = {
          totalCents: 0,
          count: 0,
          entries: [],
          cardExpenses: [],
        };
      }
      grouped[cat].totalCents += cExp.amountCents;
      grouped[cat].count += 1;
      grouped[cat].cardExpenses.push(cExp);
    }

    const totalCategoryCents = Object.values(grouped).reduce(
      (sum, item) => sum + item.totalCents,
      0,
    );

    return Object.entries(grouped)
      .map(([category, item]) => ({
        category,
        totalCents: item.totalCents,
        count: item.count,
        entries: item.entries,
        cardExpenses: item.cardExpenses,
        percent:
          totalCategoryCents > 0
            ? Math.round((item.totalCents / totalCategoryCents) * 100)
            : 0,
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [entries, cardExpenses]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      let comparison = 0;
      if (transactionSort.field === "date") {
        comparison = a.occurredOn.localeCompare(b.occurredOn) || a.id - b.id;
      } else {
        const valA = a.kind === "income" ? a.amountCents : -a.amountCents;
        const valB = b.kind === "income" ? b.amountCents : -b.amountCents;
        comparison = valA - valB;
      }
      return transactionSort.direction === "asc" ? comparison : -comparison;
    });
  }, [entries, transactionSort]);

  function toggleTransactionSort(field: TransactionSort["field"]) {
    setTransactionSort((current) => ({
      field,
      direction:
        current.field === field
          ? current.direction === "desc"
            ? "asc"
            : "desc"
          : "desc",
    }));
  }

  const currentYear = Number(month.slice(0, 4));
  const cashflowMonths = useMemo(() => {
    const monthsList: string[] = [`${currentYear - 1}-12`];
    for (let m = 1; m <= 12; m++) {
      monthsList.push(`${currentYear}-${String(m).padStart(2, "0")}`);
    }
    monthsList.push(`${currentYear + 1}-01`);
    return monthsList;
  }, [currentYear]);

  const cashflowBars = useMemo(() => {
    return cashflowMonths.map((m) => {
      const data =
        m === month
          ? {
              incomeCents: totals.income,
              expenseCents: totals.expense,
            }
          : monthlyCashflow[m] ?? { incomeCents: 0, expenseCents: 0 };
      return {
        month: m,
        incomeCents: data.incomeCents,
        expenseCents: data.expenseCents,
        isSelected: m === month,
      };
    });
  }, [cashflowMonths, monthlyCashflow, month, totals]);

  const cashflowMax = useMemo(() => {
    let max = 1;
    for (const b of cashflowBars) {
      if (b.incomeCents > max) max = b.incomeCents;
      if (b.expenseCents > max) max = b.expenseCents;
    }
    return max;
  }, [cashflowBars]);

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
    const previousEntries = entries;
    setEntryToDelete(null);
    setEntries((current) =>
      scope === "all"
        ? current.filter((e) => e.recurringRuleId !== entry.recurringRuleId || !entry.recurringRuleId)
        : scope === "future"
          ? current.filter(
              (e) =>
                e.recurringRuleId !== entry.recurringRuleId ||
                !entry.recurringRuleId ||
                e.occurredOn < entry.occurredOn,
            )
          : current.filter((e) => e.id !== entry.id),
    );
    setNotice(
      scope === "all"
        ? "Todas as recorrências deste lançamento foram excluídas."
        : scope === "future"
          ? "Este lançamento e todas as recorrências futuras foram excluídos."
          : "Lançamento excluído.",
    );
    try {
      const response = await fetch(
        `/api/transactions?id=${entry.id}&scope=${scope}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error("Não foi possível excluir.");
      }
    } catch {
      setEntries(previousEntries);
      setNotice("Não foi possível excluir o lançamento.");
    }
  }

  async function toggleStatus(entry: Entry) {
    const newStatus = entry.status === "settled" ? "pending" : "settled";
    const previousEntries = entries;
    setEntries((current) =>
      current.map((item) =>
        item.id === entry.id ? { ...item, status: newStatus } : item,
      ),
    );
    setNotice(
      entry.status === "settled"
        ? "Status reaberto."
        : entry.kind === "income"
          ? "Receita recebida."
          : "Despesa paga.",
    );
    try {
      const response = await fetch("/api/transactions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: entry.id, action: "toggle_status" }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível alterar o status.");
      }
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? body.transaction : item)),
      );
    } catch {
      setEntries(previousEntries);
      setNotice("Não foi possível alterar o status.");
    }
  }

  function statusLabel(entry: Entry) {
    if (entry.status === "settled")
      return entry.kind === "income" ? "RECEBIDO" : "PAGO";
    const overdue = entry.occurredOn < today();
    return entry.kind === "income"
      ? overdue
        ? "ATRASADO"
        : "A RECEBER"
      : overdue
        ? "VENCIDO"
        : "A PAGAR";
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
      if (body.type === "transaction_created") {
        await loadEntries();
        await loadInsights();
        setNotice(body.message || "Lançamento adicionado com sucesso.");
      }
      if (body.type === "event_created") {
        setNotice(body.message || "Compromisso adicionado à sua agenda.");
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
            : body.message || "Compra adicionada ao cartão e à fatura correspondente.",
        );
      }
      if (body.type === "event_draft") {
        setAgendaDraft(body.draft);
        setTab("Agenda");
      }
      if (body.type === "transaction_draft") {
        setDraft({ ...emptyDraft(), ...body.draft });
        setEditingId(null);
        setModalOpen(true);
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

  function toggleListening() {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      return;
    }

    if (typeof window === "undefined") return;

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setNotice(
        "Reconhecimento de voz não suportado neste navegador. Experimente no Chrome, Edge ou Safari.",
      );
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = "pt-BR";
      recognition.continuous = true;
      recognition.interimResults = true;

      // Preserva o texto base já digitado no input
      speechBaseTextRef.current = message.trim();

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const chunk = (res[0]?.transcript || "").trim();
          if (!chunk) continue;

          if (res.isFinal) {
            finalTranscript += (finalTranscript ? " " : "") + chunk;
          } else {
            interimTranscript += (interimTranscript ? " " : "") + chunk;
          }
        }

        const base = speechBaseTextRef.current;
        const spoken = [finalTranscript, interimTranscript]
          .filter(Boolean)
          .join(" ")
          .trim();
        const combined = [base, spoken]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ");

        if (combined) {
          setMessage(combined);
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (event.error === "not-allowed") {
          setNotice("Permissão de microfone negada. Permita o microfone no navegador.");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error(err);
      setIsListening(false);
      setNotice("Não foi possível iniciar o microfone.");
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
              <section className="summary-cards-grid" aria-label="Resumo financeiro mensal">
                <article className="summary-card income-card">
                  <div className="summary-card-header">
                    <span className="summary-card-pill income">
                      <span className="dot income" /> RECEITAS
                    </span>
                    <span className="summary-card-icon income">↓</span>
                  </div>
                  <div className="summary-card-body">
                    <small>Total de entradas</small>
                    <h2 className="income-val">{money(totals.income)}</h2>
                  </div>
                  <div className="summary-card-footer">
                    <span>Previsto em {monthLabel(month)}</span>
                  </div>
                </article>

                <article className="summary-card expense-card">
                  <div className="summary-card-header">
                    <span className="summary-card-pill expense">
                      <span className="dot expense" /> DESPESAS
                    </span>
                    <span className="summary-card-icon expense">↑</span>
                  </div>
                  <div className="summary-card-body">
                    <small>Total de saídas</small>
                    <h2 className="expense-val">{money(totals.expense)}</h2>
                  </div>
                  <div className="summary-card-footer">
                    <span>Contas e despesas do mês</span>
                  </div>
                </article>

                <article className="summary-card balance-card-new">
                  <div className="summary-card-header">
                    <span className="summary-card-pill balance">
                      <span className="dot balance" /> SALDO
                    </span>
                    <span className="summary-card-badge">
                      {totals.income >= totals.expense ? "● Positivo" : "● Atenção"}
                    </span>
                  </div>
                  <div className="summary-card-body">
                    <small>Saldo projetado</small>
                    <h2 className={totals.income >= totals.expense ? "positive-val" : "negative-val"}>
                      {totals.income < totals.expense ? "− " : ""}
                      {money(totals.income - totals.expense)}
                    </h2>
                  </div>
                  <div className="summary-card-footer">
                    <span>Receitas menos despesas</span>
                  </div>
                </article>
              </section>

              {tab === "Visão geral" ? (
                <>
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">DISTRIBUIÇÃO</p>
                      <h3>Gastos por categoria</h3>
                    </div>
                    <button onClick={() => setTab("Financeiro")}>
                      Ver lançamentos →
                    </button>
                  </div>
                  <div className="category-expenses-card">
                    {loading ? (
                      <div className="empty-state">Carregando gastos por categoria…</div>
                    ) : categoryExpenses.length === 0 ? (
                      <div className="empty-state">
                        <strong>Nenhum gasto registrado em {monthLabel(month)}.</strong>
                        <span>
                          Adicione despesas para acompanhar a distribuição por categorias.
                        </span>
                        <button onClick={() => openNew({ kind: "expense", occurredOn: `${month}-01` })}>
                          ＋ Registrar despesa
                        </button>
                      </div>
                    ) : (
                      <div className="category-list">
                        {categoryExpenses.map((item) => {
                          const catColor =
                            CATEGORY_COLORS[item.category] || CATEGORY_COLORS.Outros;
                          const isExpanded = expandedCategory === item.category;
                          return (
                            <div
                              className={`category-item ${isExpanded ? "expanded" : ""}`}
                              key={item.category}
                            >
                              <div
                                className="category-item-clickable"
                                onClick={() =>
                                  setExpandedCategory((prev) =>
                                    prev === item.category ? null : item.category,
                                  )
                                }
                                role="button"
                                tabIndex={0}
                                title="Clique para ver ou ocultar as transações desta categoria"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    setExpandedCategory((prev) =>
                                      prev === item.category ? null : item.category,
                                    );
                                  }
                                }}
                              >
                                <div className="category-info-header">
                                  <div className="category-name-group">
                                    <span
                                      className="category-badge-dot"
                                      style={{ backgroundColor: catColor }}
                                    />
                                    <strong>{item.category}</strong>
                                    <small className="category-count">
                                      {item.count} {item.count === 1 ? "despesa" : "despesas"}
                                    </small>
                                    <span className="category-chevron">
                                      {isExpanded ? "▲" : "▼"}
                                    </span>
                                  </div>
                                  <div className="category-amount-group">
                                    <strong>{money(item.totalCents)}</strong>
                                    <span className="category-percent-tag">
                                      {item.percent}%
                                    </span>
                                  </div>
                                </div>
                                <div className="category-progress-track">
                                  <i
                                    style={{
                                      width: `${Math.max(4, item.percent)}%`,
                                      backgroundColor: catColor,
                                    }}
                                  />
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="category-transactions-dropdown">
                                  {/* Despesas normais da conta / dinheiro */}
                                  {item.entries.map((entry) => (
                                    <div
                                      className="category-subtransaction"
                                      key={`entry-${entry.id}`}
                                    >
                                      <div className="category-subtransaction-left">
                                        <span
                                          className="sub-dot"
                                          style={{ backgroundColor: catColor }}
                                        />
                                        <div>
                                          <strong>{entry.description}</strong>
                                          <small>
                                            {displayDate(entry.occurredOn)}
                                            {entry.source === "assistant"
                                              ? " · via assistente"
                                              : ""}
                                          </small>
                                        </div>
                                      </div>
                                      <div className="category-subtransaction-right">
                                        <strong className="sub-amount">
                                          − {money(entry.amountCents)}
                                        </strong>
                                        <button
                                          className={`entry-status ${entry.status} ${entry.kind}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void toggleStatus(entry);
                                          }}
                                        >
                                          {statusLabel(entry)}
                                        </button>
                                        <button
                                          className="icon-action-mini"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openEdit(entry);
                                          }}
                                          aria-label={`Editar ${entry.description}`}
                                          title="Editar lançamento"
                                        >
                                          ✎
                                        </button>
                                      </div>
                                    </div>
                                  ))}

                                  {/* Compras no cartão de crédito nesta categoria */}
                                  {item.cardExpenses.map((cExp) => (
                                    <div
                                      className="category-subtransaction"
                                      key={`card-exp-${cExp.installmentId}`}
                                    >
                                      <div className="category-subtransaction-left">
                                        <span
                                          className="sub-dot"
                                          style={{ backgroundColor: catColor }}
                                        />
                                        <div>
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "6px",
                                              flexWrap: "wrap",
                                            }}
                                          >
                                            <strong>{cExp.description}</strong>
                                            <span
                                              style={{
                                                fontSize: "0.72rem",
                                                padding: "1px 6px",
                                                borderRadius: "4px",
                                                background: "rgba(255, 255, 255, 0.08)",
                                                border: "1px solid rgba(255, 255, 255, 0.14)",
                                                color: "var(--text-secondary, #94a3b8)",
                                                fontWeight: 500,
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "3px",
                                              }}
                                            >
                                              💳 {cExp.cardName}
                                              {cExp.installmentCount > 1
                                                ? ` (${cExp.installmentNumber}/${cExp.installmentCount})`
                                                : ""}
                                            </span>
                                          </div>
                                          <small>
                                            {displayDate(cExp.purchaseDate)} · Compra no cartão
                                          </small>
                                        </div>
                                      </div>
                                      <div className="category-subtransaction-right">
                                        <strong className="sub-amount">
                                          − {money(cExp.amountCents)}
                                        </strong>
                                        <span
                                          className={`entry-status ${cExp.status === "paid" ? "settled" : "pending"} expense`}
                                          style={{ cursor: "default" }}
                                          title={cExp.status === "paid" ? "Fatura paga" : "Fatura aberta"}
                                        >
                                          {cExp.status === "paid" ? "Paga" : "Aberta"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="section-title chart-section-title">
                    <div>
                      <p className="eyebrow">FLUXO FINANCEIRO (14 MESES)</p>
                      <h3>Entradas e saídas</h3>
                    </div>
                    <div className="cashflow-legend">
                      <span className="legend-item income">
                        <i /> Entradas
                      </span>
                      <span className="legend-item expense">
                        <i /> Saídas
                      </span>
                    </div>
                  </div>
                  <section
                    className="cashflow-chart-card"
                    aria-label="Gráfico comparativo de entradas e saídas ao longo dos meses"
                  >
                    <div className="cashflow-bars-container">
                      {cashflowBars.map((item) => {
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
                        const isPrev = item.month.startsWith(String(currentYear - 1));
                        const isNext = item.month.startsWith(String(currentYear + 1));
                        const label = isPrev
                          ? `Dez/${y.slice(2)}`
                          : isNext
                            ? `Jan/${y.slice(2)}`
                            : shortMonths[Number(m)] ?? m;

                        const incHeight =
                          item.incomeCents > 0
                            ? Math.max(6, (item.incomeCents / cashflowMax) * 100)
                            : 0;
                        const expHeight =
                          item.expenseCents > 0
                            ? Math.max(6, (item.expenseCents / cashflowMax) * 100)
                            : 0;

                        return (
                          <div
                            className={`cashflow-column ${item.isSelected ? "active" : ""} ${isPrev || isNext ? "edge-column" : ""}`}
                            key={item.month}
                            onClick={() => setMonth(item.month)}
                            role="button"
                            tabIndex={0}
                            title={`${formatMonth(item.month)}\nEntradas: ${money(item.incomeCents)}\nSaídas: ${money(item.expenseCents)}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") setMonth(item.month);
                            }}
                          >
                            <div className="cashflow-bars-pair">
                              <div className="cashflow-bar-wrapper">
                                <div
                                  className="cashflow-bar income-bar"
                                  style={{
                                    height: `${incHeight}%`,
                                    opacity: item.incomeCents > 0 ? 1 : 0.2,
                                  }}
                                />
                              </div>
                              <div className="cashflow-bar-wrapper">
                                <div
                                  className="cashflow-bar expense-bar"
                                  style={{
                                    height: `${expHeight}%`,
                                    opacity: item.expenseCents > 0 ? 1 : 0.2,
                                  }}
                                />
                              </div>
                            </div>
                            <span className="cashflow-label">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">MOVIMENTAÇÃO</p>
                      <h3>Todos os lançamentos</h3>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <div className="purchase-sort" aria-label="Ordenar lançamentos">
                        {(["date", "value"] as const).map((field) => {
                          const active = transactionSort.field === field;
                          return (
                            <button
                              key={field}
                              className={active ? "active" : ""}
                              onClick={() => toggleTransactionSort(field)}
                              aria-pressed={active}
                              aria-label={`Ordenar por ${field === "date" ? "data" : "valor"}`}
                              title={`Ordenar por ${field === "date" ? "data" : "valor"} (${active ? (transactionSort.direction === "desc" ? "decrescente, clique para crescente" : "crescente, clique para decrescente") : "clique para ordenar"})`}
                            >
                              <span aria-hidden="true">
                                {field === "date" ? "▣" : "R$"}
                              </span>
                              {field === "date" ? "Data" : "Valor"}
                              {active && (
                                <b aria-hidden="true">
                                  {transactionSort.direction === "desc" ? "↓" : "↑"}
                                </b>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => setTab("Visão geral")}>
                        Ver resumo →
                      </button>
                    </div>
                  </div>
                  <div className="transactions finance-transactions">
                    {loading ? (
                      <div className="empty-state">
                        Carregando seus lançamentos…
                      </div>
                    ) : sortedEntries.length === 0 ? (
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
                      sortedEntries.map((entry) => (
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
                </>
              )}
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
                  <button
                    type="button"
                    className={`mic-btn ${isListening ? "listening" : ""}`}
                    onClick={toggleListening}
                    aria-label={isListening ? "Parar gravação de áudio" : "Gravar mensagem por voz"}
                    title={isListening ? "Ouvindo sua voz... Clique para parar" : "Falar mensagem por voz (áudio)"}
                  >
                    {isListening ? (
                      <span className="mic-rec-dot" />
                    ) : (
                      <span className="mic-icon">🎙</span>
                    )}
                  </button>
                  <span>{isListening ? "Ouvindo você..." : "Enter para enviar"}</span>
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

      <ImportBackupModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onNotice={setNotice}
        onImported={async () => {
          await Promise.all([loadEntries(), loadInsights()]);
        }}
      />

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
