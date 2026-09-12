import { isTelegramConfigured, sendTelegramMessage } from "../../../../lib/telegram";

export async function POST(request: Request) {
  try {
    const configured = isTelegramConfigured();
    if (!configured) {
      return Response.json(
        {
          error:
            "Telegram não configurado! Adicione TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no seu arquivo .env.local para ativar os envios.",
          configured: false,
        },
        { status: 400 },
      );
    }

    let customText: string | undefined;
    try {
      const body = (await request.json()) as { message?: string };
      customText = body.message;
    } catch {}

    const textToSend =
      customText ||
      `🤖 *Nexo — Teste de Notificação!*\n\nSeu bot do Telegram foi conectado com sucesso ao Nexo Assistente Pessoal.\n\nA partir de agora você receberá seus lembretes de agenda e contas a pagar aqui!`;

    const result = await sendTelegramMessage(textToSend, {
      parseMode: "Markdown",
    });

    return Response.json({
      success: true,
      message: "Mensagem de teste enviada com sucesso para o seu Telegram!",
      messageId: result.messageId,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao enviar mensagem de teste.",
      },
      { status: 500 },
    );
  }
}
