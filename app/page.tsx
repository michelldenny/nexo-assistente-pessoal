"use client";

import { useEffect, useMemo, useState } from "react";

type Entry = {
  id: number;
  description: string;
  category: string;
  occurredOn: string;
  amountCents: number;
  kind: "expense" | "income";
  source: "manual" | "assistant";
};

type Draft = { kind: "expense" | "income"; description: string; category: string; amount: string; occurredOn: string };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const emptyDraft = (): Draft => ({ kind: "expense", description: "", category: "Outros", amount: "", occurredOn: today() });
const colors: Record<string, string> = { Alimentação: "#ef7b45", Trabalho: "#1f9d7a", Assinaturas: "#7559d9", Transporte: "#e6ae37", Moradia: "#4e83c4", Saúde: "#d35873", Outros: "#758079" };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Math.abs(cents) / 100);
const displayDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("Posso registrar lançamentos, consultar seus gastos e explicar o que mudou no seu mês.");
  const [tab, setTab] = useState("Visão geral");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void loadEntries(); }, []);
  async function loadEntries() {
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEntries(body.transactions);
    } catch { setNotice("Não foi possível carregar seus dados agora."); }
    finally { setLoading(false); }
  }

  const totals = useMemo(() => ({
    income: entries.filter(e => e.kind === "income").reduce((sum, e) => sum + e.amountCents, 0),
    expense: entries.filter(e => e.kind === "expense").reduce((sum, e) => sum + e.amountCents, 0),
  }), [entries]);

  function openNew(prefill?: Partial<Draft>) {
    setEditingId(null);
    setDraft({ ...emptyDraft(), ...prefill });
    setModalOpen(true);
  }

  function openEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraft({ kind: entry.kind, description: entry.description, category: entry.category, amount: (entry.amountCents / 100).toFixed(2).replace(".", ","), occurredOn: entry.occurredOn });
    setModalOpen(true);
  }

  async function saveDraft(source: "manual" | "assistant" = "manual") {
    const amountCents = Math.round(Number(draft.amount.replace(".", "").replace(",", ".")) * 100);
    if (!draft.description.trim() || !Number.isSafeInteger(amountCents) || amountCents <= 0) { setNotice("Preencha descrição e valor corretamente."); return; }
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/transactions", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingId, ...draft, amountCents, source }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEntries(current => editingId ? current.map(e => e.id === editingId ? body.transaction : e) : [body.transaction, ...current]);
      setModalOpen(false);
      setNotice(editingId ? "Lançamento atualizado." : "Lançamento salvo.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }

  async function removeEntry(entry: Entry) {
    if (!window.confirm(`Excluir “${entry.description}”?`)) return;
    const response = await fetch(`/api/transactions?id=${entry.id}`, { method: "DELETE" });
    if (response.ok) { setEntries(current => current.filter(e => e.id !== entry.id)); setNotice("Lançamento excluído."); }
    else setNotice("Não foi possível excluir.");
  }

  async function sendMessage(text = message) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const found = cleaned.match(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/i);
    if (/gast|paguei|comprei|recebi|ganhei/i.test(cleaned) && found) {
      const amount = found[1];
      const kind = /recebi|ganhei/i.test(cleaned) ? "income" : "expense";
      const description = /mercado/i.test(cleaned) ? "Mercado" : /ifood|delivery/i.test(cleaned) ? "Delivery" : kind === "income" ? "Recebimento" : "Novo lançamento";
      const category = description === "Mercado" || description === "Delivery" ? "Alimentação" : kind === "income" ? "Trabalho" : "Outros";
      setDraft({ kind, description, category, amount, occurredOn: today() });
      setMessage("");
      setReply(`Entendi: ${kind === "expense" ? "despesa" : "receita"} de ${money(Math.round(Number(amount.replace(",", ".")) * 100))} em ${description}. Revise e confirme.`);
      setEditingId(null); setModalOpen(true);
    } else if (/quanto|resumo|gastei/i.test(cleaned)) {
      setReply(`Neste mês, suas despesas somam ${money(totals.expense)} e suas receitas ${money(totals.income)}. Seu saldo é ${money(totals.income - totals.expense)}.`);
      setMessage("");
    } else {
      setReply("No momento posso registrar receitas e despesas ou responder perguntas sobre seus totais. A interpretação avançada por IA entra na próxima etapa.");
      setMessage("");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">n</span><span>nexo</span></div>
        <nav aria-label="Navegação principal">
          {["Visão geral", "Financeiro", "Assistente"].map((item, index) => <button key={item} className={tab === item ? "nav-item active" : "nav-item"} onClick={() => setTab(item)}><span>{["⌂", "↗", "✦"][index]}</span>{item}</button>)}
          <p className="nav-label">EM BREVE</p>
          {["Agenda", "Documentos"].map(item => <button key={item} className="nav-item muted" disabled><span>○</span>{item}</button>)}
        </nav>
        <div className="profile"><div className="avatar">MR</div><div><strong>Minha conta</strong><small>Espaço privado</small></div><button aria-label="Mais opções">•••</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">SEU PAINEL PESSOAL</p><h1>{tab === "Visão geral" ? "Bom dia, Michell." : tab}</h1></div><button className="primary" onClick={() => openNew()}><span>＋</span>Novo lançamento</button></header>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Fechar aviso">×</button></div>}

        <div className="content-grid">
          <section className="main-column">
            <article className="balance-card">
              <div className="balance-head"><div><p>Saldo atual</p><h2>{money(totals.income - totals.expense)}</h2></div><span className="status-pill">● Dados salvos</span></div>
              <div className="mini-stats"><div><span className="dot income"/>Receitas<strong>{money(totals.income)}</strong></div><div><span className="dot expense"/>Despesas<strong>{money(totals.expense)}</strong></div><div className="spark-bars" aria-label="Movimento ilustrativo">{[38,52,44,67,58,76,49,86,64,74,92,81].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div></div>
            </article>

            <div className="section-title"><div><p className="eyebrow">MOVIMENTAÇÃO</p><h3>{tab === "Financeiro" ? "Todos os lançamentos" : "Últimos lançamentos"}</h3></div><button onClick={() => setTab(tab === "Financeiro" ? "Visão geral" : "Financeiro")}>{tab === "Financeiro" ? "Ver resumo" : "Ver todos"} →</button></div>
            <div className="transactions">
              {loading ? <div className="empty-state">Carregando seus lançamentos…</div> : entries.length === 0 ? <div className="empty-state"><strong>Seu financeiro começa aqui.</strong><span>Registre a primeira receita ou despesa pelo botão acima ou pelo assistente.</span><button onClick={() => openNew()}>Criar primeiro lançamento</button></div> : entries.slice(0, tab === "Financeiro" ? 200 : 5).map(entry => <div className="transaction" key={entry.id}>
                <div className="transaction-icon" style={{background: `${colors[entry.category] ?? colors.Outros}18`, color: colors[entry.category] ?? colors.Outros}}>{entry.description.charAt(0).toUpperCase()}</div>
                <div className="transaction-copy"><strong>{entry.description}</strong><small>{entry.category} · {displayDate(entry.occurredOn)}{entry.source === "assistant" ? " · via assistente" : ""}</small></div>
                <strong className={entry.kind}>{entry.kind === "income" ? "+ " : "− "}{money(entry.amountCents)}</strong>
                <div className="row-actions"><button onClick={() => openEdit(entry)} aria-label={`Editar ${entry.description}`}>Editar</button><button className="danger" onClick={() => void removeEntry(entry)} aria-label={`Excluir ${entry.description}`}>Excluir</button></div>
              </div>)}
            </div>
          </section>

          <aside className="assistant-card">
            <div className="assistant-head"><div className="assistant-orb">✦</div><div><strong>Assistente Nexo</strong><small><span>●</span> Pronto para ajudar</small></div><button aria-label="Menu do assistente">•••</button></div>
            <div className="conversation"><p className="assistant-label">NEXO · AGORA</p><div className="bubble">{reply}</div><div className="suggestions"><button onClick={() => void sendMessage("Quanto gastei este mês?")}>Quanto gastei este mês?</button><button onClick={() => setMessage("Gastei 89,90 no mercado")}>Registrar uma despesa</button><button onClick={() => setMessage("Recebi 2500 de um projeto")}>Registrar uma receita</button></div></div>
            <div className="composer"><textarea aria-label="Mensagem para o assistente" placeholder="Fale com o Nexo..." value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }}}/><div><button aria-label="Anexar arquivo">＋</button><span>Enter para enviar</span><button className="send" onClick={() => void sendMessage()} aria-label="Enviar mensagem">↑</button></div></div>
          </aside>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={e => e.stopPropagation()}><button className="modal-close" onClick={() => setModalOpen(false)}>×</button><p className="eyebrow">{editingId ? "EDITAR LANÇAMENTO" : "NOVO LANÇAMENTO"}</p><h2 id="modal-title">{editingId ? "Ajuste os dados" : "Registre do seu jeito"}</h2><div className="type-toggle"><button className={draft.kind === "expense" ? "selected" : ""} onClick={() => setDraft(d => ({...d, kind:"expense"}))}>Despesa</button><button className={draft.kind === "income" ? "selected" : ""} onClick={() => setDraft(d => ({...d, kind:"income"}))}>Receita</button></div><label>Descrição<input autoFocus value={draft.description} onChange={e => setDraft(d => ({...d, description:e.target.value}))} placeholder="Ex.: Mercado"/></label><div className="field-row"><label>Valor<input inputMode="decimal" value={draft.amount} onChange={e => setDraft(d => ({...d, amount:e.target.value}))} placeholder="0,00"/></label><label>Data<input type="date" value={draft.occurredOn} onChange={e => setDraft(d => ({...d, occurredOn:e.target.value}))}/></label></div><label>Categoria<select value={draft.category} onChange={e => setDraft(d => ({...d, category:e.target.value}))}>{["Alimentação","Trabalho","Assinaturas","Transporte","Moradia","Saúde","Outros"].map(c=><option key={c}>{c}</option>)}</select></label><button className="primary wide" disabled={saving} onClick={() => void saveDraft(editingId ? "manual" : reply.includes("Revise e confirme") ? "assistant" : "manual")}>{saving ? "Salvando…" : editingId ? "Salvar alterações" : "Salvar lançamento"}</button></div></div>}
    </main>
  );
}
