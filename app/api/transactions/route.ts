import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { transactions } from "../../../db/schema";

type Payload = { kind?: "expense" | "income"; description?: string; category?: string; amountCents?: number; occurredOn?: string; source?: "manual" | "assistant" };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

function validate(payload: Payload) {
  const description = payload.description?.trim() ?? "";
  const category = payload.category?.trim() || "Outros";
  const amountCents = Math.round(Number(payload.amountCents));
  const occurredOn = payload.occurredOn ?? "";
  if (payload.kind !== "expense" && payload.kind !== "income") return { error: "Tipo inválido." } as const;
  if (!description || description.length > 120) return { error: "Informe uma descrição de até 120 caracteres." } as const;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { error: "Informe um valor válido." } as const;
  if (!validDate(occurredOn)) return { error: "Informe uma data válida." } as const;
  return { data: { kind: payload.kind, description, category: category.slice(0, 60), amountCents, occurredOn, source: payload.source === "assistant" ? "assistant" as const : "manual" as const } } as const;
}

export async function GET() {
  try {
    const rows = await getDb().select().from(transactions).where(isNull(transactions.deletedAt)).orderBy(desc(transactions.occurredOn), desc(transactions.id)).limit(200);
    return Response.json({ transactions: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os lançamentos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const checked = validate(await request.json() as Payload);
    if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
    const [row] = await getDb().insert(transactions).values(checked.data).returning();
    return Response.json({ transaction: row }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível criar o lançamento." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as Payload & { id?: number };
    const id = Math.round(Number(payload.id));
    const checked = validate(payload);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Lançamento inválido." }, { status: 400 });
    if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
    const [row] = await getDb().update(transactions).set({ ...checked.data, updatedAt: new Date().toISOString() }).where(and(eq(transactions.id, id), isNull(transactions.deletedAt))).returning();
    if (!row) return Response.json({ error: "Lançamento não encontrado." }, { status: 404 });
    return Response.json({ transaction: row });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível editar o lançamento." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Math.round(Number(new URL(request.url).searchParams.get("id")));
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Lançamento inválido." }, { status: 400 });
    const [row] = await getDb().update(transactions).set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(transactions.id, id), isNull(transactions.deletedAt))).returning({ id: transactions.id });
    if (!row) return Response.json({ error: "Lançamento não encontrado." }, { status: 404 });
    return Response.json({ deleted: true, id: row.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível excluir o lançamento." }, { status: 500 });
  }
}
