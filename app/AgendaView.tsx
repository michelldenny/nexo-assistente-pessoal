"use client";

import { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { formatMonth } from "./ui-format";

type EventItem = {
  id: number;
  title: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string | null;
  color: string;
  status: "scheduled" | "completed";
};
export type EventDraft = {
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  color: string;
  status: "scheduled" | "completed";
};
const localDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const newDraft = (date = localDate()): EventDraft => ({
  title: "",
  eventDate: date,
  startTime: "09:00",
  endTime: "",
  location: "",
  notes: "",
  color: "green",
  status: "scheduled",
});
const monthLabel = (date: Date) =>
  formatMonth(
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
  );
const longDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace(/\s+de\s+/gi, " ");

export default function AgendaView({
  onNotice,
  pendingDraft,
  onDraftOpened,
  selectedMonth,
  onMonthChange,
}: {
  onNotice: (message: string) => void;
  pendingDraft?: EventDraft | null;
  onDraftOpened?: () => void;
  selectedMonth?: string;
  onMonthChange?: (m: string) => void;
}) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [month, setMonth] = useState(() => {
    if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) {
      const [y, m] = selectedMonth.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, 1));
    }
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });

  useEffect(() => {
    if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) {
      const [y, m] = selectedMonth.split("-").map(Number);
      setMonth(new Date(Date.UTC(y, m - 1, 1)));
    }
  }, [selectedMonth]);

  const updateMonth = (newDate: Date) => {
    setMonth(newDate);
    const key = `${newDate.getUTCFullYear()}-${String(newDate.getUTCMonth() + 1).padStart(2, "0")}`;
    onMonthChange?.(key);
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EventDraft>(newDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<EventItem | null>(null);

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!pendingDraft) return;
    setEditingId(null);
    setDraft(pendingDraft);
    setModalOpen(true);
    onDraftOpened?.();
  }, [pendingDraft, onDraftOpened]);
  async function load() {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEvents(body.events);
    } catch {
      onNotice("Não foi possível carregar a agenda agora.");
    } finally {
      setLoading(false);
    }
  }

  const days = useMemo(() => {
    const year = month.getUTCFullYear(),
      monthIndex = month.getUTCMonth();
    const startOffset = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return [
      ...Array(startOffset).fill(null),
      ...Array.from({ length: count }, (_, i) => i + 1),
    ];
  }, [month]);
  const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const upcoming = events
    .filter(
      (event) => event.eventDate >= localDate() && event.status === "scheduled",
    )
    .slice(0, 6);

  function openNew(date?: string) {
    setEditingId(null);
    setDraft(newDraft(date));
    setModalOpen(true);
  }
  function openEdit(event: EventItem) {
    setEditingId(event.id);
    setDraft({
      title: event.title,
      eventDate: event.eventDate,
      startTime: event.startTime ?? "",
      endTime: event.endTime ?? "",
      location: event.location ?? "",
      notes: event.notes ?? "",
      color: event.color,
      status: event.status,
    });
    setModalOpen(true);
  }
  async function save() {
    if (!draft.title.trim() || !draft.eventDate) {
      onNotice("Informe título e data do compromisso.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/events", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editingId, ...draft }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEvents((current) =>
        editingId
          ? current
              .map((item) => (item.id === editingId ? body.event : item))
              .sort(sortEvents)
          : [...current, body.event].sort(sortEvents),
      );
      setModalOpen(false);
      onNotice(editingId ? "Compromisso atualizado." : "Compromisso criado.");
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function toggle(event: EventItem) {
    const nextStatus = event.status === "completed" ? "scheduled" : "completed";
    const previousEvents = events;
    setEvents((current) =>
      current.map((item) =>
        item.id === event.id ? { ...item, status: nextStatus } : item,
      ),
    );
    try {
      const response = await fetch("/api/events", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: event.id,
          status: nextStatus,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível atualizar.");
      setEvents((current) =>
        current.map((item) => (item.id === event.id ? body.event : item)),
      );
    } catch (error) {
      setEvents(previousEvents);
      onNotice(
        error instanceof Error ? error.message : "Não foi possível atualizar.",
      );
    }
  }
  async function remove(event: EventItem) {
    const previousEvents = events;
    setEventToDelete(null);
    setEvents((current) => current.filter((item) => item.id !== event.id));
    onNotice("Compromisso excluído.");
    try {
      const response = await fetch(`/api/events?id=${event.id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível excluir.");
    } catch (error) {
      setEvents(previousEvents);
      onNotice(
        error instanceof Error ? error.message : "Não foi possível excluir.",
      );
    }
  }

  return (
    <>
      <div className="agenda-toolbar">
        <div>
          <p className="eyebrow">AGENDA PESSOAL</p>
          <h2>{monthLabel(month)}</h2>
        </div>
        <div className="agenda-tools">
          <button
            onClick={() =>
              updateMonth(
                new Date(
                  Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1),
                ),
              )
            }
            aria-label="Mês anterior"
          >
            ←
          </button>
          <button
            onClick={() => {
              const now = new Date();
              updateMonth(
                new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)),
              );
            }}
          >
            Hoje
          </button>
          <button
            onClick={() =>
              updateMonth(
                new Date(
                  Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
                ),
              )
            }
            aria-label="Próximo mês"
          >
            →
          </button>
          <button className="primary" onClick={() => openNew()}>
            <span>＋</span>Novo compromisso
          </button>
        </div>
      </div>
      <div className="agenda-layout">
        <section className="calendar-card">
          <div className="weekdays">
            {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day, index) => {
              if (!day)
                return (
                  <div
                    className="calendar-day outside"
                    key={`blank-${index}`}
                  />
                );
              const date = `${monthKey}-${String(day).padStart(2, "0")}`;
              const dayEvents = events.filter(
                (event) => event.eventDate === date,
              );
              return (
                <button
                  className={`calendar-day ${date === localDate() ? "today" : ""}`}
                  key={date}
                  onClick={() => openNew(date)}
                >
                  <span className="day-number">{day}</span>
                  <div className="day-events">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        className={`event-chip ${event.color} ${event.status}`}
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(event);
                        }}
                      >
                        {event.startTime ?? ""} {event.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <small>+{dayEvents.length - 3} mais</small>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <aside className="upcoming-card">
          <div className="upcoming-head">
            <p className="eyebrow">PRÓXIMOS</p>
            <strong>{upcoming.length} compromissos</strong>
          </div>
          {loading ? (
            <div className="agenda-empty">Carregando…</div>
          ) : upcoming.length === 0 ? (
            <div className="agenda-empty">
              <span>○</span>
              <strong>Sua agenda está livre.</strong>
              <small>Crie um compromisso para começar.</small>
              <button onClick={() => openNew()}>Adicionar compromisso</button>
            </div>
          ) : (
            <div className="upcoming-list">
              {upcoming.map((event) => (
                <article key={event.id} className={event.status}>
                  <button
                    className="event-check"
                    onClick={() => void toggle(event)}
                    aria-label="Marcar como concluído"
                  >
                    ✓
                  </button>
                  <div className={`event-line ${event.color}`} />
                  <div className="upcoming-copy">
                    <small>
                      {longDate(event.eventDate)} ·{" "}
                      {event.startTime ?? "Dia inteiro"}
                    </small>
                    <strong>{event.title}</strong>
                    {event.location && <span>⌖ {event.location}</span>}
                  </div>
                  <button
                    className="event-more"
                    onClick={() => openEdit(event)}
                  >
                    •••
                  </button>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
      {modalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setModalOpen(false)}
        >
          <div
            className="modal agenda-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setModalOpen(false)}>
              ×
            </button>
            <p className="eyebrow">
              {editingId ? "EDITAR COMPROMISSO" : "NOVO COMPROMISSO"}
            </p>
            <h2>{editingId ? "Ajuste sua agenda" : "O que está por vir?"}</h2>
            <label>
              Título
              <input
                autoFocus
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                placeholder="Ex.: Consulta com dentista"
              />
            </label>
            <div className="field-row">
              <label>
                Data
                <input
                  type="date"
                  value={draft.eventDate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, eventDate: e.target.value }))
                  }
                />
              </label>
              <label>
                Início
                <input
                  type="time"
                  value={draft.startTime}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, startTime: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="field-row">
              <label>
                Término
                <input
                  type="time"
                  value={draft.endTime}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, endTime: e.target.value }))
                  }
                />
              </label>
              <label>
                Local
                <input
                  value={draft.location}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, location: e.target.value }))
                  }
                  placeholder="Opcional"
                />
              </label>
            </div>
            <label>
              Notas
              <textarea
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
                placeholder="Detalhes importantes…"
              />
            </label>
            <div className="color-picker" aria-label="Cor do compromisso">
              {["green", "lime", "coral", "purple"].map((color) => (
                <button
                  key={color}
                  className={`${color} ${draft.color === color ? "selected" : ""}`}
                  onClick={() => setDraft((d) => ({ ...d, color }))}
                  aria-label={`Cor ${color}`}
                />
              ))}
            </div>
            <button
              className="primary wide"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving
                ? "Salvando…"
                : editingId
                  ? "Salvar alterações"
                  : "Criar compromisso"}
            </button>
            {editingId && (
              <div className="agenda-modal-actions">
                <button
                  onClick={() =>
                    void toggle(events.find((e) => e.id === editingId)!)
                  }
                >
                  {draft.status === "completed"
                    ? "Reabrir"
                    : "Marcar concluído"}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    const event = events.find((e) => e.id === editingId);
                    if (event) setEventToDelete(event);
                    setModalOpen(false);
                  }}
                >
                  Excluir
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(eventToDelete)}
        title="Excluir compromisso?"
        message={
          eventToDelete
            ? `O compromisso “${eventToDelete.title}” será removido da sua agenda.`
            : ""
        }
        confirmLabel="Excluir"
        danger
        onCancel={() => setEventToDelete(null)}
        onConfirm={() => eventToDelete && void remove(eventToDelete)}
      />
    </>
  );
}

function sortEvents(a: EventItem, b: EventItem) {
  return `${a.eventDate}${a.startTime ?? ""}`.localeCompare(
    `${b.eventDate}${b.startTime ?? ""}`,
  );
}
