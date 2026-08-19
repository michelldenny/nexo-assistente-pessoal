import { env } from "cloudflare:workers";
import { isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { calendarEvents, transactions } from "../../../db/schema";

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
type Content = { role?: string; parts?: Part[] };
type GeminiResponse = { candidates?: Array<{ content?: Content }>; error?: { message?: string } };

const functionDeclarations = [
  { name: "prepare_transaction", description: "Prepare uma receita ou despesa para revisão antes de salvar.", parameters: { type: "OBJECT", properties: {
    kind: { type: "STRING", enum: ["expense", "income"] }, description: { type: "STRING" },
    category: { type: "STRING", enum: ["Alimentação", "Trabalho", "Assinaturas", "Transporte", "Moradia", "Saúde", "Outros"] },
    amount_cents: { type: "INTEGER", minimum: 1 }, occurred_on: { type: "STRING", description: "Data YYYY-MM-DD." },
  }, required: ["kind", "description", "category", "amount_cents", "occurred_on"] } },
  { name: "summarize_finances", description: "Consulte receitas, despesas e saldo salvos.", parameters: { type: "OBJECT", properties: {} } },
  { name: "prepare_calendar_event", description: "Prepare um compromisso para revisão antes de salvar na agenda.", parameters: { type: "OBJECT", properties: {
    title: { type: "STRING" }, event_date: { type: "STRING", description: "Data YYYY-MM-DD." },
    start_time: { type: "STRING", description: "Hora HH:MM ou string vazia." }, end_time: { type: "STRING", description: "Hora HH:MM ou string vazia." },
    location: { type: "STRING" }, notes: { type: "STRING" }, color: { type: "STRING", enum: ["green", "lime", "coral", "purple"] },
  }, required: ["title", "event_date", "start_time", "end_time", "location", "notes", "color"] } },
  { name: "list_calendar_events", description: "Consulte os próximos compromissos salvos.", parameters: { type: "OBJECT", properties: {} } },
];

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

async function callGemini(contents: Content[]) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada.");
  const model = env.GEMINI_MODEL || "gemini-3.6-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `Você é o Nexo, assistente pessoal financeiro e de agenda. Responda em português do Brasil, de forma curta. Hoje em São Paulo é ${today()}. Use as ferramentas para preparar registros ou consultar dados. Nunca diga que salvou algo apenas preparado.` }] },
      contents, tools: [{ functionDeclarations }], toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    }),
  });
  const body = await response.json() as GeminiResponse;
  if (!response.ok) throw new Error(body.error?.message || "Falha ao consultar o Gemini.");
  return body;
}

const contentOf = (body: GeminiResponse) => body.candidates?.[0]?.content;
const textOf = (body: GeminiResponse) => contentOf(body)?.parts?.map(part => part.text ?? "").join("").trim() || "Como posso ajudar?";

export async function POST(request: Request) {
  try {
    const { message } = await request.json() as { message?: string };
    if (!message?.trim() || message.length > 600) return Response.json({ error: "Envie uma mensagem válida." }, { status: 400 });
    const user: Content = { role: "user", parts: [{ text: message.trim() }] };
    const first = await callGemini([user]);
    const model = contentOf(first);
    const call = model?.parts?.find(part => part.functionCall)?.functionCall;
    if (!call) return Response.json({ type: "message", message: textOf(first) });

    if (call.name === "prepare_transaction") {
      const a = call.args as { kind: "expense" | "income"; description: string; category: string; amount_cents: number; occurred_on: string };
      return Response.json({ type: "transaction_draft", message: "Revise os dados antes de confirmar.", draft: { kind: a.kind, description: a.description, category: a.category, amount: (a.amount_cents / 100).toFixed(2).replace(".", ","), occurredOn: a.occurred_on } });
    }
    if (call.name === "prepare_calendar_event") {
      const a = call.args as { title: string; event_date: string; start_time: string; end_time: string; location: string; notes: string; color: string };
      return Response.json({ type: "event_draft", message: "Preparei o compromisso. Revise os dados antes de confirmar.", draft: { title: a.title, eventDate: a.event_date, startTime: a.start_time, endTime: a.end_time, location: a.location, notes: a.notes, color: a.color, status: "scheduled" } });
    }

    let result: Record<string, unknown>;
    if (call.name === "summarize_finances") {
      const rows = await getDb().select({ kind: transactions.kind, amountCents: transactions.amountCents }).from(transactions).where(isNull(transactions.deletedAt));
      const sums = rows.reduce((acc, row) => { acc[row.kind] += row.amountCents; return acc; }, { expense: 0, income: 0 });
      result = { income_cents: sums.income, expense_cents: sums.expense, balance_cents: sums.income - sums.expense, currency: "BRL" };
    } else {
      const rows = await getDb().select().from(calendarEvents).where(isNull(calendarEvents.deletedAt));
      result = { today: today(), events: rows.filter(e => e.eventDate >= today() && e.status === "scheduled").sort((a, b) => `${a.eventDate}${a.startTime ?? ""}`.localeCompare(`${b.eventDate}${b.startTime ?? ""}`)).slice(0, 20) };
    }
    const final = await callGemini([user, { role: "model", parts: model?.parts ?? [] }, { role: "user", parts: [{ functionResponse: { name: call.name, response: result } }] }]);
    return Response.json({ type: "message", message: textOf(final) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "O assistente não respondeu." }, { status: 500 });
  }
}
