import { env } from "cloudflare:workers";
import { isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { transactions } from "../../../db/schema";

type FunctionCall = { type: "function_call"; name: string; arguments: string; call_id: string };

const tools = [
  {
    type: "function",
    name: "prepare_transaction",
    description: "Prepare a single income or expense for user review. Never claim it was saved.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["expense", "income"] },
        description: { type: "string" },
        category: { type: "string", enum: ["Alimentação", "Trabalho", "Assinaturas", "Transporte", "Moradia", "Saúde", "Outros"] },
        amount_cents: { type: "integer", minimum: 1 },
        occurred_on: { type: "string", description: "Accounting date in YYYY-MM-DD format." },
      },
      required: ["kind", "description", "category", "amount_cents", "occurred_on"],
    },
  },
  {
    type: "function",
    name: "summarize_finances",
    description: "Answer questions about saved income, expenses and current balance.",
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
];

async function callOpenAI(input: unknown) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.4-mini",
      instructions: "Você é o Nexo, assistente financeiro pessoal. Responda em português do Brasil, de forma curta. Para registrar algo, use prepare_transaction. Para consultar valores salvos, use summarize_finances. Nunca diga que salvou uma operação apenas preparada.",
      tools,
      input,
    }),
  });
  const body = await response.json() as { output?: Array<FunctionCall | { type: string; content?: Array<{ type: string; text?: string }> }>; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "Falha ao consultar a OpenAI.");
  return body;
}

function outputText(body: Awaited<ReturnType<typeof callOpenAI>>) {
  return body.output?.flatMap(item => "content" in item ? item.content ?? [] : []).find(part => part.type === "output_text")?.text ?? "Como posso ajudar?";
}

export async function POST(request: Request) {
  try {
    const { message } = await request.json() as { message?: string };
    if (!message?.trim() || message.length > 600) return Response.json({ error: "Envie uma mensagem válida." }, { status: 400 });
    const first = await callOpenAI([{ role: "user", content: message.trim() }]);
    const call = first.output?.find((item): item is FunctionCall => item.type === "function_call");
    if (!call) return Response.json({ type: "message", message: outputText(first) });

    if (call.name === "prepare_transaction") {
      const args = JSON.parse(call.arguments) as { kind: "expense" | "income"; description: string; category: string; amount_cents: number; occurred_on: string };
      return Response.json({ type: "transaction_draft", message: "Revise os dados antes de confirmar.", draft: { kind: args.kind, description: args.description, category: args.category, amount: (args.amount_cents / 100).toFixed(2).replace(".", ","), occurredOn: args.occurred_on } });
    }

    const rows = await getDb().select({ kind: transactions.kind, amountCents: transactions.amountCents }).from(transactions).where(isNull(transactions.deletedAt));
    const summary = rows.reduce((acc, row) => { acc[row.kind] += row.amountCents; return acc; }, { expense: 0, income: 0 });
    const final = await callOpenAI([
      { role: "user", content: message.trim() },
      ...(first.output ?? []),
      { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ income_cents: summary.income, expense_cents: summary.expense, balance_cents: summary.income - summary.expense, currency: "BRL" }) },
    ]);
    return Response.json({ type: "message", message: outputText(final) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "O assistente não respondeu." }, { status: 500 });
  }
}
