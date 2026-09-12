type TelegramSendOptions = {
  chatId?: string;
  parseMode?: "HTML" | "Markdown";
};

export function isTelegramConfigured(): boolean {
  const token =
    process.env.TELEGRAM_BOT_TOKEN ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_CHAT_ID ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.TELEGRAM_CHAT_ID;
  return Boolean(token?.trim() && chatId?.trim());
}

export async function sendTelegramMessage(
  text: string,
  options?: TelegramSendOptions,
): Promise<{ ok: boolean; messageId?: number }> {
  const token =
    process.env.TELEGRAM_BOT_TOKEN ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.TELEGRAM_BOT_TOKEN;
  const targetChatId =
    options?.chatId ||
    process.env.TELEGRAM_CHAT_ID ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.TELEGRAM_CHAT_ID;

  if (!token?.trim()) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN não configurado. Defina essa variável no seu .env.local.",
    );
  }
  if (!targetChatId?.trim()) {
    throw new Error(
      "TELEGRAM_CHAT_ID não configurado. Defina essa variável no seu .env.local.",
    );
  }

  const url = `https://api.telegram.org/bot${token.trim()}/sendMessage`;

  const payload: Record<string, unknown> = {
    chat_id: targetChatId.trim(),
    text,
    disable_web_page_preview: true,
  };

  if (options?.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id?: number };
  };

  if (!res.ok || !data.ok) {
    throw new Error(
      data.description ||
        `Erro ao enviar mensagem pelo Telegram (status ${res.status}).`,
    );
  }

  return { ok: true, messageId: data.result?.message_id };
}
