import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { calendarEvents } from "../../../db/schema";

type Payload = { id?: number; title?: string; eventDate?: string; startTime?: string; endTime?: string; location?: string; notes?: string; color?: string; status?: "scheduled" | "completed" };
const dateOk = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const timeOk = (value?: string) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function validate(payload: Payload) {
  const title = payload.title?.trim() ?? "";
  const eventDate = payload.eventDate ?? "";
  if (!title || title.length > 120) return { error: "Informe um título de até 120 caracteres." } as const;
  if (!dateOk(eventDate)) return { error: "Informe uma data válida." } as const;
  if (!timeOk(payload.startTime) || !timeOk(payload.endTime)) return { error: "Informe um horário válido." } as const;
  return { data: { title, eventDate, startTime: payload.startTime || null, endTime: payload.endTime || null, location: payload.location?.trim().slice(0, 120) || null, notes: payload.notes?.trim().slice(0, 1000) || null, color: ["green", "lime", "coral", "purple"].includes(payload.color ?? "") ? payload.color! : "green", status: payload.status === "completed" ? "completed" as const : "scheduled" as const } } as const;
}

export async function GET() {
  try {
    const rows = await getDb().select().from(calendarEvents).where(isNull(calendarEvents.deletedAt)).orderBy(asc(calendarEvents.eventDate), asc(calendarEvents.startTime), asc(calendarEvents.id));
    return Response.json({ events: rows });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar a agenda." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const checked = validate(await request.json() as Payload);
    if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
    const [event] = await getDb().insert(calendarEvents).values(checked.data).returning();
    return Response.json({ event }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível criar o compromisso." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as Payload;
    const id = Math.round(Number(payload.id));
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Compromisso inválido." }, { status: 400 });
    if (payload.status && Object.keys(payload).every(key => ["id", "status"].includes(key))) {
      const [event] = await getDb().update(calendarEvents).set({ status: payload.status, updatedAt: new Date().toISOString() }).where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt))).returning();
      return event ? Response.json({ event }) : Response.json({ error: "Compromisso não encontrado." }, { status: 404 });
    }
    const checked = validate(payload);
    if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
    const [event] = await getDb().update(calendarEvents).set({ ...checked.data, updatedAt: new Date().toISOString() }).where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt))).returning();
    return event ? Response.json({ event }) : Response.json({ error: "Compromisso não encontrado." }, { status: 404 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o compromisso." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const id = Math.round(Number(new URL(request.url).searchParams.get("id")));
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Compromisso inválido." }, { status: 400 });
    const [event] = await getDb().update(calendarEvents).set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt))).returning({ id: calendarEvents.id });
    return event ? Response.json({ deleted: true }) : Response.json({ error: "Compromisso não encontrado." }, { status: 404 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível excluir o compromisso." }, { status: 500 }); }
}
