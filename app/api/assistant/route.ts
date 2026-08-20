import { env } from "cloudflare:workers";
import { camel, getSupabase } from "../../../db/supabase";
import { INCOME_CATEGORIES, TRANSACTION_CATEGORIES } from "../../categories";
import { createCardPurchase } from "../../../db/card-purchases";

type Part = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};
type Content = { role?: string; parts?: Part[] };
type GeminiResponse = {
  candidates?: Array<{ content?: Content }>;
  error?: { message?: string };
};

const functionDeclarations = [
  {
    name: "prepare_transaction",
    description: "Prepare uma receita ou despesa para revisão antes de salvar.",
    parameters: {
      type: "OBJECT",
      properties: {
        kind: { type: "STRING", enum: ["expense", "income"] },
        description: { type: "STRING" },
        category: {
          type: "STRING",
          enum: [...TRANSACTION_CATEGORIES, ...INCOME_CATEGORIES],
          description:
            "Para expense use somente categorias de despesa. Para income use somente categorias de receita.",
        },
        amount_cents: { type: "INTEGER", minimum: 1 },
        occurred_on: { type: "STRING", description: "Data YYYY-MM-DD." },
      },
      required: [
        "kind",
        "description",
        "category",
        "amount_cents",
        "occurred_on",
      ],
    },
  },
  {
    name: "create_card_purchase",
    description:
      "Cadastre imediatamente uma compra feita em um cartão de crédito. Use quando o usuário disser que gastou ou comprou em um cartão identificado.",
    parameters: {
      type: "OBJECT",
      properties: {
        card_name: {
          type: "STRING",
          description: "Apelido ou banco do cartão informado pelo usuário.",
        },
        description: { type: "STRING" },
        category: { type: "STRING", enum: TRANSACTION_CATEGORIES },
        amount_cents: { type: "INTEGER", minimum: 1 },
        purchase_date: { type: "STRING", description: "Data YYYY-MM-DD." },
        installment_count: { type: "INTEGER", minimum: 1, maximum: 60 },
      },
      required: [
        "card_name",
        "description",
        "category",
        "amount_cents",
        "purchase_date",
        "installment_count",
      ],
    },
  },
  {
    name: "summarize_finances",
    description: "Consulte receitas, despesas e saldo salvos.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "prepare_calendar_event",
    description:
      "Prepare um compromisso para revisão antes de salvar na agenda.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        event_date: { type: "STRING", description: "Data YYYY-MM-DD." },
        start_time: {
          type: "STRING",
          description: "Hora HH:MM ou string vazia.",
        },
        end_time: {
          type: "STRING",
          description: "Hora HH:MM ou string vazia.",
        },
        location: { type: "STRING" },
        notes: { type: "STRING" },
        color: { type: "STRING", enum: ["green", "lime", "coral", "purple"] },
      },
      required: [
        "title",
        "event_date",
        "start_time",
        "end_time",
        "location",
        "notes",
        "color",
      ],
    },
  },
  {
    name: "list_calendar_events",
    description: "Consulte os próximos compromissos salvos.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

async function callGemini(contents: Content[]) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada.");
  const model = env.GEMINI_MODEL || "gemini-3.6-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `Você é o Nexo, assistente pessoal financeiro e de agenda. Responda em português do Brasil, de forma curta. Hoje em São Paulo é ${today()}. Use as ferramentas para preparar registros ou consultar dados. Nunca diga que salvou algo apenas preparado.`,
            },
          ],
        },
        contents,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      }),
    },
  );
  const body = (await response.json()) as GeminiResponse;
  if (!response.ok)
    throw new Error(body.error?.message || "Falha ao consultar o Gemini.");
  return body;
}

const contentOf = (body: GeminiResponse) => body.candidates?.[0]?.content;
const textOf = (body: GeminiResponse) =>
  contentOf(body)
    ?.parts?.map((part) => part.text ?? "")
    .join("")
    .trim() || "Como posso ajudar?";

export async function POST(request: Request) {
  try {
    const { message } = (await request.json()) as { message?: string };
    if (!message?.trim() || message.length > 600)
      return Response.json(
        { error: "Envie uma mensagem válida." },
        { status: 400 },
      );
    const user: Content = { role: "user", parts: [{ text: message.trim() }] };
    const first = await callGemini([user]);
    const model = contentOf(first);
    const call = model?.parts?.find((part) => part.functionCall)?.functionCall;
    if (!call)
      return Response.json({ type: "message", message: textOf(first) });

    if (call.name === "prepare_transaction") {
      const a = call.args as {
        kind: "expense" | "income";
        description: string;
        category: string;
        amount_cents: number;
        occurred_on: string;
      };
      return Response.json({
        type: "transaction_draft",
        message: "Revise os dados antes de confirmar.",
        draft: {
          kind: a.kind,
          description: a.description,
          category: a.category,
          amount: (a.amount_cents / 100).toFixed(2).replace(".", ","),
          occurredOn: a.occurred_on,
        },
      });
    }
    if (call.name === "create_card_purchase") {
      const a = call.args as {
        card_name: string;
        description: string;
        category: string;
        amount_cents: number;
        purchase_date: string;
        installment_count: number;
      };
      const saved = await createCardPurchase({
        cardName: a.card_name,
        description: a.description,
        category: a.category,
        totalCents: Math.round(a.amount_cents),
        purchaseDate: a.purchase_date,
        installmentCount: Math.round(a.installment_count),
      });
      return Response.json({
        type: "purchase_created",
        message: `${a.description} foi lançado diretamente no cartão ${saved.card.name}${a.installment_count > 1 ? ` em ${a.installment_count} parcelas` : ""}.`,
      });
    }
    if (call.name === "prepare_calendar_event") {
      const a = call.args as {
        title: string;
        event_date: string;
        start_time: string;
        end_time: string;
        location: string;
        notes: string;
        color: string;
      };
      return Response.json({
        type: "event_draft",
        message: "Preparei o compromisso. Revise os dados antes de confirmar.",
        draft: {
          title: a.title,
          eventDate: a.event_date,
          startTime: a.start_time,
          endTime: a.end_time,
          location: a.location,
          notes: a.notes,
          color: a.color,
          status: "scheduled",
        },
      });
    }

    let result: Record<string, unknown>;
    if (call.name === "summarize_finances") {
      const { data, error } = await getSupabase()
        .from("transactions")
        .select("kind,amount_cents")
        .is("deleted_at", null);
      if (error) throw error;
      const sums = (data ?? []).reduce(
        (acc, row) => {
          acc[row.kind as "expense" | "income"] += row.amount_cents;
          return acc;
        },
        { expense: 0, income: 0 },
      );
      result = {
        income_cents: sums.income,
        expense_cents: sums.expense,
        balance_cents: sums.income - sums.expense,
        currency: "BRL",
      };
    } else {
      const { data, error } = await getSupabase()
        .from("calendar_events")
        .select("*")
        .is("deleted_at", null)
        .gte("event_date", today())
        .eq("status", "scheduled")
        .order("event_date")
        .order("start_time")
        .limit(20);
      if (error) throw error;
      result = {
        today: today(),
        events: (data ?? []).map((row) => camel(row)),
      };
    }
    const final = await callGemini([
      user,
      { role: "model", parts: model?.parts ?? [] },
      {
        role: "user",
        parts: [{ functionResponse: { name: call.name, response: result } }],
      },
    ]);
    return Response.json({ type: "message", message: textOf(final) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "O assistente não respondeu.",
      },
      { status: 500 },
    );
  }
}
