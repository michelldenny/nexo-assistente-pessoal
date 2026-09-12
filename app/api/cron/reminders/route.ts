import { getSupabase } from "../../../../db/supabase";
import { isTelegramConfigured, sendTelegramMessage } from "../../../../lib/telegram";

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatDateBr(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export async function handleReminders(request: Request) {
  try {
    const cronSecret =
      process.env.CRON_SECRET ||
      (globalThis as unknown as { env?: Record<string, string> }).env
        ?.CRON_SECRET;

    if (cronSecret?.trim()) {
      const authHeader = request.headers.get("authorization");
      const url = new URL(request.url);
      const querySecret = url.searchParams.get("secret");

      const isAuthorized =
        authHeader === `Bearer ${cronSecret.trim()}` ||
        querySecret === cronSecret.trim();

      if (!isAuthorized) {
        return Response.json(
          { error: "Acesso não autorizado. CRON_SECRET inválido." },
          { status: 401 },
        );
      }
    }

    const db = getSupabase();
    const currentDate = today();
    const [currentYear, currentMonth, currentDay] = currentDate
      .split("-")
      .map(Number);

    // 1. Compromissos de hoje na agenda
    const { data: events, error: eventsError } = await db
      .from("calendar_events")
      .select("id, title, event_date, start_time, end_time, location, notes")
      .eq("event_date", currentDate)
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .order("start_time", { ascending: true, nullsFirst: false });

    if (eventsError) throw eventsError;

    // 2. Contas a pagar (despesas) hoje ou atrasadas
    const { data: expenses, error: expensesError } = await db
      .from("transactions")
      .select("id, description, amount_cents, occurred_on, status, category")
      .eq("kind", "expense")
      .neq("status", "settled")
      .lte("occurred_on", currentDate)
      .is("deleted_at", null)
      .order("occurred_on", { ascending: true });

    if (expensesError) throw expensesError;

    const overdueExpenses = (expenses ?? []).filter(
      (e) => e.occurred_on < currentDate,
    );
    const todayExpenses = (expenses ?? []).filter(
      (e) => e.occurred_on === currentDate,
    );

    // 3. Cartões de crédito (faturas fechando ou vencendo)
    const { data: cards, error: cardsError } = await db
      .from("credit_cards")
      .select("id, name, closing_day, due_day")
      .is("deleted_at", null);

    if (cardsError) throw cardsError;

    const closingCards = (cards ?? []).filter(
      (c) => c.closing_day === currentDay,
    );
    const dueCardsToday = (cards ?? []).filter((c) => c.due_day === currentDay);
    const dueCardsSoon = (cards ?? []).filter((c) => {
      const diff = c.due_day - currentDay;
      return diff >= 1 && diff <= 3;
    });

    const totalItems =
      (events?.length ?? 0) +
      todayExpenses.length +
      overdueExpenses.length +
      closingCards.length +
      dueCardsToday.length;

    // Construção da mensagem formatada para o Telegram
    const lines: string[] = [];

    lines.push(`☀️ *Nexo — Resumo do Dia (${formatDateBr(currentDate)})*`);
    lines.push("");

    if (events && events.length > 0) {
      lines.push(`📅 *Compromissos de Hoje (${events.length}):*`);
      for (const ev of events) {
        const time = ev.start_time ? `\`${ev.start_time.slice(0, 5)}\`` : "Dia todo";
        const loc = ev.location ? ` _(${ev.location})_` : "";
        lines.push(`  • ${time} — *${ev.title}*${loc}`);
      }
      lines.push("");
    }

    if (todayExpenses.length > 0) {
      const totalToday = todayExpenses.reduce(
        (sum, e) => sum + e.amount_cents,
        0,
      );
      lines.push(
        `💸 *Contas a Pagar Hoje (${todayExpenses.length} — Total: ${formatCurrency(totalToday)}):*`,
      );
      for (const exp of todayExpenses) {
        lines.push(
          `  • *${exp.description}*: ${formatCurrency(exp.amount_cents)}`,
        );
      }
      lines.push("");
    }

    if (overdueExpenses.length > 0) {
      const totalOverdue = overdueExpenses.reduce(
        (sum, e) => sum + e.amount_cents,
        0,
      );
      lines.push(
        `⚠️ *Atenção — Contas Atrasadas (${overdueExpenses.length} — Total: ${formatCurrency(totalOverdue)}):*`,
      );
      for (const exp of overdueExpenses) {
        lines.push(
          `  • *${exp.description}*: ${formatCurrency(exp.amount_cents)} _(venceu em ${formatDateBr(exp.occurred_on)})_`,
        );
      }
      lines.push("");
    }

    if (
      closingCards.length > 0 ||
      dueCardsToday.length > 0 ||
      dueCardsSoon.length > 0
    ) {
      lines.push("💳 *Cartões de Crédito:*");
      for (const card of closingCards) {
        lines.push(`  • Fatura do cartão *${card.name}* fecha hoje!`);
      }
      for (const card of dueCardsToday) {
        lines.push(`  • Fatura do cartão *${card.name}* *VENCE HOJE*!`);
      }
      for (const card of dueCardsSoon) {
        const days = card.due_day - currentDay;
        lines.push(
          `  • Fatura do cartão *${card.name}* vence em ${days} ${days === 1 ? "dia" : "dias"}.`,
        );
      }
      lines.push("");
    }

    if (totalItems === 0) {
      lines.push(
        "Tudo em ordem! Você não possui compromissos agendados nem contas pendentes para hoje. Tenha um ótimo dia!",
      );
    }

    const messageText = lines.join("\n").trim();

    // Enviar mensagem se o Telegram estiver configurado
    let telegramSent = false;
    let telegramError: string | null = null;

    if (isTelegramConfigured()) {
      try {
        await sendTelegramMessage(messageText, { parseMode: "Markdown" });
        telegramSent = true;
      } catch (err) {
        telegramError =
          err instanceof Error ? err.message : "Falha ao enviar para o Telegram.";
      }
    } else {
      telegramError =
        "Telegram não configurado (TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID ausentes no .env.local).";
    }

    return Response.json({
      success: true,
      currentDate,
      totalItems,
      eventsCount: events?.length ?? 0,
      todayExpensesCount: todayExpenses.length,
      overdueExpensesCount: overdueExpenses.length,
      telegramConfigured: isTelegramConfigured(),
      telegramSent,
      telegramError,
      preview: messageText,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao processar lembretes.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleReminders(request);
}

export async function POST(request: Request) {
  return handleReminders(request);
}
