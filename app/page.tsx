"use client";

import { useMemo, useState } from "react";

type Entry = { id: number; title: string; category: string; date: string; amount: number; kind: "expense" | "income"; color: string };

const seed: Entry[] = [
  { id: 1, title: "Mercado São Jorge", category: "Alimentação", date: "Hoje, 09:42", amount: -287.43, kind: "expense", color: "#ef7b45" },
  { id: 2, title: "Freelance — Aurora", category: "Trabalho", date: "Ontem, 16:20", amount: 3200, kind: "income", color: "#1f9d7a" },
  { id: 3, title: "Spotify", category: "Assinaturas", date: "18 ago, 08:00", amount: -21.9, kind: "expense", color: "#7559d9" },
  { id: 4, title: "Posto Avenida", category: "Transporte", date: "17 ago, 19:12", amount: -250, kind: "expense", color: "#e6ae37" },
];

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Math.abs(value));

export default function Home() {
  const [entries, setEntries] = useState(seed);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("Posso registrar lançamentos, consultar seus gastos e explicar o que mudou no seu mês.");
  const [tab, setTab] = useState("Visão geral");
  const [composerOpen, setComposerOpen] = useState(false);
  const totals = useMemo(() => ({
    income: entries.filter(e => e.kind === "income").reduce((sum, e) => sum + e.amount, 0),
    expense: Math.abs(entries.filter(e => e.kind === "expense").reduce((sum, e) => sum + e.amount, 0)),
  }), [entries]);

  function sendMessage(text = message) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const found = cleaned.match(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/i);
    if (/gast|paguei|comprei/i.test(cleaned) && found) {
      const amount = Number(found[1].replace(".", "").replace(",", "."));
      const title = /mercado/i.test(cleaned) ? "Mercado" : /ifood|delivery/i.test(cleaned) ? "Delivery" : "Novo lançamento";
      setEntries(current => [{ id: Date.now(), title, category: title === "Mercado" ? "Alimentação" : "Outros", date: "Agora", amount: -amount, kind: "expense", color: "#ef7b45" }, ...current]);
      setReply(`Pronto — registrei ${money(amount)} como despesa em ${title}. Você pode revisar ou desfazer o lançamento.`);
    } else if (/quanto|resumo|gastei/i.test(cleaned)) {
      setReply(`Neste mês, suas despesas somam ${money(totals.expense)}. Alimentação é a categoria com maior movimento recente.`);
    } else {
      setReply("Entendi. No MVP, posso registrar receitas e despesas ou responder perguntas sobre seus lançamentos.");
    }
    setMessage("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">n</span><span>nexo</span></div>
        <nav aria-label="Navegação principal">
          {["Visão geral", "Financeiro", "Assistente"].map((item, index) => (
            <button key={item} className={tab === item ? "nav-item active" : "nav-item"} onClick={() => setTab(item)}>
              <span>{["⌂", "↗", "✦"][index]}</span>{item}
            </button>
          ))}
          <p className="nav-label">EM BREVE</p>
          {["Agenda", "Documentos"].map(item => <button key={item} className="nav-item muted" disabled><span>○</span>{item}</button>)}
        </nav>
        <div className="profile"><div className="avatar">MV</div><div><strong>Minha conta</strong><small>Plano pessoal</small></div><button aria-label="Mais opções">•••</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">QUARTA-FEIRA, 19 DE AGOSTO</p><h1>Bom dia, Michel.</h1></div>
          <button className="primary" onClick={() => setComposerOpen(true)}><span>＋</span>Novo lançamento</button>
        </header>

        <div className="content-grid">
          <section className="main-column">
            <article className="balance-card">
              <div className="balance-head"><div><p>Saldo do mês</p><h2>{money(totals.income - totals.expense)}</h2></div><span className="status-pill">● 12,4% melhor</span></div>
              <div className="mini-stats"><div><span className="dot income"/>Receitas<strong>{money(totals.income)}</strong></div><div><span className="dot expense"/>Despesas<strong>{money(totals.expense)}</strong></div><div className="spark-bars" aria-label="Movimento do mês">{[38,52,44,67,58,76,49,86,64,74,92,81].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div></div>
            </article>

            <div className="section-title"><div><p className="eyebrow">MOVIMENTAÇÃO</p><h3>Últimos lançamentos</h3></div><button onClick={() => setTab("Financeiro")}>Ver todos →</button></div>
            <div className="transactions">
              {entries.slice(0,5).map(entry => <div className="transaction" key={entry.id}>
                <div className="transaction-icon" style={{background: `${entry.color}18`, color: entry.color}}>{entry.title.charAt(0)}</div>
                <div className="transaction-copy"><strong>{entry.title}</strong><small>{entry.category} · {entry.date}</small></div>
                <strong className={entry.kind}>{entry.amount > 0 ? "+ " : "− "}{money(entry.amount)}</strong>
              </div>)}
            </div>
          </section>

          <aside className="assistant-card">
            <div className="assistant-head"><div className="assistant-orb">✦</div><div><strong>Assistente Nexo</strong><small><span>●</span> Pronto para ajudar</small></div><button aria-label="Menu do assistente">•••</button></div>
            <div className="conversation">
              <p className="assistant-label">NEXO · AGORA</p>
              <div className="bubble">{reply}</div>
              <div className="suggestions">
                <button onClick={() => sendMessage("Quanto gastei este mês?")}>Quanto gastei este mês?</button>
                <button onClick={() => setMessage("Gastei 89,90 no mercado")}>Registrar uma despesa</button>
              </div>
            </div>
            <div className="composer"><textarea aria-label="Mensagem para o assistente" placeholder="Fale com o Nexo..." value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}/><div><button aria-label="Anexar arquivo">＋</button><span>Enter para enviar</span><button className="send" onClick={() => sendMessage()} aria-label="Enviar mensagem">↑</button></div></div>
          </aside>
        </div>
      </section>

      {composerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setComposerOpen(false)}><div className="modal" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}><button className="modal-close" onClick={() => setComposerOpen(false)}>×</button><p className="eyebrow">NOVO LANÇAMENTO</p><h2>Registre do seu jeito</h2><p>Use linguagem natural e o assistente organiza valor, categoria e data.</p><textarea autoFocus value={message} onChange={e => setMessage(e.target.value)} placeholder="Ex.: Gastei 89,90 no mercado hoje"/><button className="primary wide" onClick={() => { sendMessage(); setComposerOpen(false); }}>Registrar com IA</button></div></div>}
    </main>
  );
}
