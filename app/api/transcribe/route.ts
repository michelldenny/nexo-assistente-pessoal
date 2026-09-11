export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        {
          error:
            "OPENAI_API_KEY não configurada no servidor. Verifique o arquivo .env.local.",
        },
        { status: 500 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return Response.json(
        { error: "Arquivo de áudio não enviado ou inválido." },
        { status: 400 },
      );
    }

    // Prepara payload para a OpenAI Whisper API
    const whisperFormData = new FormData();
    whisperFormData.append("file", file, "audio.webm");
    whisperFormData.append("model", "whisper-1");
    whisperFormData.append("language", "pt");
    whisperFormData.append("temperature", "0.2");
    whisperFormData.append(
      "prompt",
      "Transcreva com pontuação correta e termos em português do Brasil, incluindo finanças, compras, parcelas, contas, valores em reais e agenda.",
    );

    const openAiRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: whisperFormData,
      },
    );

    if (!openAiRes.ok) {
      const errorText = await openAiRes.text();
      console.error("OpenAI Whisper Error:", errorText);
      return Response.json(
        {
          error: "Falha ao transcrever o áudio com a IA.",
          details: errorText,
        },
        { status: openAiRes.status },
      );
    }

    const data = await openAiRes.json();
    return Response.json({
      text: (data.text || "").trim(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("Transcribe API Error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
