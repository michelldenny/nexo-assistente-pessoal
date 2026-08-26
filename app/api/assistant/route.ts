import { camel, getSupabase } from "../../../db/supabase";
import { INCOME_CATEGORIES, TRANSACTION_CATEGORIES } from "../../categories";
import {
  createCardPurchase,
  createCardPurchases,
} from "../../../db/card-purchases";

type Part = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
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
    name: "create_transaction",
    description:
      "Cadastre imediatamente uma receita ou despesa no financeiro do usuário. Use sempre que o usuário pedir para registrar, gastar, pagar ou receber valores.",
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
      "Cadastre imediatamente uma compra ou estorno/crédito feito em um cartão de crédito. Use quando o usuário disser que gastou, comprou ou recebeu um estorno em um cartão identificado. Para estornos, utilize amount_cents negativo.",
    parameters: {
      type: "OBJECT",
      properties: {
        card_name: {
          type: "STRING",
          description: "Apelido ou banco do cartão informado pelo usuário.",
        },
        description: { type: "STRING" },
        category: { type: "STRING", enum: TRANSACTION_CATEGORIES },
        amount_cents: {
          type: "INTEGER",
          description:
            "Valor em centavos. Positivo para compras/despesas e negativo para estornos/créditos.",
        },
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
    name: "create_card_statement_purchases",
    description:
      "Importe de uma só vez TODAS as transações e estornos identificados em uma fatura ou extrato de cartão anexado. Para estornos/créditos, mantenha o valor amount_cents negativo.",
    parameters: {
      type: "OBJECT",
      properties: {
        card_name: {
          type: "STRING",
          description: "Apelido ou banco do cartão identificado na fatura.",
        },
        purchases: {
          type: "ARRAY",
          description:
            "Lista completa de transações da fatura (compras e estornos/créditos), sem incluir pagamentos de fatura ou saldo anterior.",
          items: {
            type: "OBJECT",
            properties: {
              description: { type: "STRING" },
              category: { type: "STRING", enum: TRANSACTION_CATEGORIES },
              amount_cents: {
                type: "INTEGER",
                description:
                  "Valor em centavos. Positivo para compra e negativo para estorno/crédito.",
              },
              purchase_date: {
                type: "STRING",
                description: "Data YYYY-MM-DD.",
              },
              installment_count: { type: "INTEGER", minimum: 1, maximum: 60 },
            },
            required: [
              "description",
              "category",
              "amount_cents",
              "purchase_date",
              "installment_count",
            ],
          },
        },
      },
      required: ["card_name", "purchases"],
    },
  },
  {
    name: "summarize_finances",
    description:
      "Consulte receitas, salário, despesas, categorias e saldo salvos no financeiro do usuário. Use SEMPRE que o usuário perguntar sobre finanças, salário, rendimentos, gastos, planejamento ou pedir cálculos orçamentários (como regra 50/30/20, metas ou cortes de gastos).",
    parameters: {
      type: "OBJECT",
      properties: {
        month: {
          type: "STRING",
          description: "Mês de referência YYYY-MM (opcional, padrão mês corrente).",
        },
      },
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Cadastre imediatamente um compromisso ou evento na agenda do usuário.",
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
  const geminiApiKey =
    process.env.GEMINI_API_KEY ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.GEMINI_API_KEY;
  const geminiModel =
    process.env.GEMINI_MODEL ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.GEMINI_MODEL ||
    "gemini-3.6-flash";

  if (!geminiApiKey) throw new Error("GEMINI_API_KEY não configurada.");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `Você é o Nexo, assistente pessoal financeiro e de agenda. Responda em português do Brasil, de forma clara, prática e empática. Hoje em São Paulo é ${today()}.
Leia imagens, PDFs, textos e planilhas anexados, extraindo valores, datas, estabelecimentos, cartões e parcelas.
Sempre que o usuário perguntar sobre orçamento, finanças, gastos, quanto ganha/gasta, planejamento ou pedir cálculos com base no salário/renda (como a regra 50/30/20 ou limites de gastos), CONSULTE IMEDIATAMENTE as finanças do usuário chamando summarize_finances para obter o salário e despesas reais cadastradas, usando esses números reais na resposta sem perguntar o que já está salvo.
Se o usuário pedir apenas para ler ou analisar um anexo, responda com a análise sem cadastrar nada. Só salve compras de cartão quando ele pedir explicitamente para registrar. Quando ele pedir para adicionar ou importar uma fatura/extrato inteiro, chame create_card_statement_purchases UMA ÚNICA VEZ enviando TODAS as compras. Não duplique nem invente dados.`,
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
    const { message, attachment } = (await request.json()) as {
      message?: string;
      attachment?: { name?: string; mimeType?: string; data?: string };
    };
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/csv",
    ]);
    const hasAttachment = Boolean(
      attachment?.data &&
      attachment?.mimeType &&
      allowed.has(attachment.mimeType),
    );
    if ((!message?.trim() && !hasAttachment) || (message?.length ?? 0) > 600)
      return Response.json(
        { error: "Envie uma mensagem ou um arquivo válido." },
        { status: 400 },
      );
    if (attachment?.data && attachment.data.length > 4_700_000)
      return Response.json(
        { error: "O arquivo é maior que o limite de 3,5 MB." },
        { status: 413 },
      );
    const parts: Part[] = [
      {
        text:
          message?.trim() ||
          `Analise o arquivo ${attachment?.name ?? "anexado"}. Identifique os dados financeiros, datas, estabelecimento, cartão e parcelas quando existirem.`,
      },
    ];
    if (hasAttachment)
      parts.push({
        inlineData: {
          mimeType: attachment!.mimeType!,
          data: attachment!.data!,
        },
      });
    const user: Content = { role: "user", parts };
    const first = await callGemini([user]);
    const model = contentOf(first);
    const call = model?.parts?.find((part) => part.functionCall)?.functionCall;
    if (!call)
      return Response.json({ type: "message", message: textOf(first) });

    if (call.name === "create_transaction") {
      const a = call.args as {
        kind: "expense" | "income";
        description: string;
        category: string;
        amount_cents: number;
        occurred_on: string;
      };
      const db = getSupabase();
      const { data, error } = await db
        .from("transactions")
        .insert({
          kind: a.kind,
          description: a.description,
          category: a.category || "Outros",
          amount_cents: Math.round(a.amount_cents),
          occurred_on: a.occurred_on,
          status: "settled",
          source: "assistant",
        })
        .select()
        .single();
      if (error) throw error;
      const formatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(a.amount_cents / 100);
      return Response.json({
        type: "transaction_created",
        transaction: camel(data),
        message: `${a.kind === "income" ? "Receita" : "Despesa"} de ${formatted} (“${a.description}”) registrada com sucesso no seu financeiro.`,
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
    if (call.name === "create_card_statement_purchases") {
      const a = call.args as {
        card_name: string;
        purchases: Array<{
          description: string;
          category: string;
          amount_cents: number;
          purchase_date: string;
          installment_count: number;
        }>;
      };
      const allowedCategories = new Set<string>(TRANSACTION_CATEGORIES);
      const purchases = (Array.isArray(a.purchases) ? a.purchases : [])
        .slice(0, 100)
        .filter(
          (purchase) =>
            purchase.description?.trim() &&
            Number.isFinite(purchase.amount_cents) &&
            purchase.amount_cents !== 0 &&
            /^\d{4}-\d{2}-\d{2}$/.test(purchase.purchase_date),
        )
        .map((purchase) => ({
          description: purchase.description.trim(),
          category: allowedCategories.has(purchase.category)
            ? purchase.category
            : "Outros",
          totalCents: Math.round(purchase.amount_cents),
          purchaseDate: purchase.purchase_date,
          installmentCount: Math.min(
            60,
            Math.max(1, Math.round(purchase.installment_count || 1)),
          ),
        }));
      const saved = await createCardPurchases({
        cardName: a.card_name,
        purchases,
      });
      return Response.json({
        type: "purchases_created",
        count: saved.count,
        message: `${saved.count} transações da fatura foram adicionadas ao cartão ${saved.card.name}.`,
      });
    }
    if (call.name === "create_calendar_event") {
      const a = call.args as {
        title: string;
        event_date: string;
        start_time?: string;
        end_time?: string;
        location?: string;
        notes?: string;
        color?: string;
      };
      const db = getSupabase();
      const { data, error } = await db
        .from("calendar_events")
        .insert({
          title: a.title,
          event_date: a.event_date,
          start_time: a.start_time || null,
          end_time: a.end_time || null,
          location: a.location || "",
          notes: a.notes || "",
          color: a.color || "green",
          status: "scheduled",
        })
        .select()
        .single();
      if (error) throw error;
      const [year, month, day] = a.event_date.split("-");
      return Response.json({
        type: "event_created",
        event: camel(data),
        message: `Compromisso “${a.title}” adicionado à sua agenda para o dia ${day}/${month}${a.start_time ? ` às ${a.start_time}` : ""}.`,
      });
    }

    let result: Record<string, unknown>;
    if (call.name === "summarize_finances") {
      const args = (call.args || {}) as { month?: string };
      const targetMonth = args.month || today().slice(0, 7);
      const db = getSupabase();
      
      const { data, error } = await db
        .from("transactions")
        .select("id,kind,description,category,amount_cents,occurred_on,status")
        .is("deleted_at", null)
        .order("occurred_on", { ascending: false });
      if (error) throw error;

      const allRows = data ?? [];
      const currentMonthRows = allRows.filter((r) =>
        r.occurred_on.startsWith(targetMonth),
      );
      
      // Se não houver transações no mês atual, usa os dados mais recentes disponíveis
      const activeRows = currentMonthRows.length > 0 ? currentMonthRows : allRows;

      const incomeRows = activeRows.filter((r) => r.kind === "income");
      const expenseRows = activeRows.filter((r) => r.kind === "expense");

      const incomeTotalCents = incomeRows.reduce(
        (sum, r) => sum + r.amount_cents,
        0,
      );
      const expenseTotalCents = expenseRows.reduce(
        (sum, r) => sum + r.amount_cents,
        0,
      );

      const expensesByCategory: Record<string, number> = {};
      for (const exp of expenseRows) {
        const cat = exp.category || "Outros";
        expensesByCategory[cat] = (expensesByCategory[cat] ?? 0) + exp.amount_cents;
      }

      const salaryEntries = incomeRows.filter(
        (r) =>
          r.category === "Salário" ||
          /sal[aá]rio|remunera[cç]|pr[oó]-labore|honor[aá]rio/i.test(r.description),
      );

      result = {
        reference_month: targetMonth,
        monthly_income_cents: incomeTotalCents,
        monthly_income_formatted: `R$ ${(incomeTotalCents / 100).toFixed(2).replace(".", ",")}`,
        monthly_expense_cents: expenseTotalCents,
        monthly_expense_formatted: `R$ ${(expenseTotalCents / 100).toFixed(2).replace(".", ",")}`,
        balance_cents: incomeTotalCents - expenseTotalCents,
        balance_formatted: `R$ ${((incomeTotalCents - expenseTotalCents) / 100).toFixed(2).replace(".", ",")}`,
        salary_entries: salaryEntries.map((s) => ({
          description: s.description,
          amount_cents: s.amount_cents,
          formatted: `R$ ${(s.amount_cents / 100).toFixed(2).replace(".", ",")}`,
        })),
        income_sources: incomeRows.map((inc) => ({
          description: inc.description,
          category: inc.category,
          amount_cents: inc.amount_cents,
          formatted: `R$ ${(inc.amount_cents / 100).toFixed(2).replace(".", ",")}`,
        })),
        expenses_by_category: Object.entries(expensesByCategory).map(
          ([category, amount_cents]) => ({
            category,
            amount_cents,
            formatted: `R$ ${(amount_cents / 100).toFixed(2).replace(".", ",")}`,
            percent_of_income:
              incomeTotalCents > 0
                ? Math.round((amount_cents / incomeTotalCents) * 100)
                : null,
          }),
        ),
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
