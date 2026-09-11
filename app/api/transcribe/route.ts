async function transcribeWithGemini(
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const geminiApiKey =
    process.env.GEMINI_API_KEY ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.GEMINI_API_KEY;
  const geminiModel =
    process.env.GEMINI_MODEL ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.GEMINI_MODEL ||
    "gemini-3.6-flash";

  if (!geminiApiKey) return null;

  try {
    const base64Audio = buffer.toString("base64");
    // Garante um mimeType de áudio aceito pelo Gemini
    const audioMime =
      mimeType && mimeType.startsWith("audio/") ? mimeType : "audio/webm";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiApiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: audioMime,
                    data: base64Audio,
                  },
                },
                {
                  text: "Transcreva exatamente o que foi dito neste áudio em português do Brasil. Inclua pontuação adequada, termos em português, números, compras, finanças ou datas. Retorne estritamente o texto transcrito, sem introdução, sem aspas, sem 'Transcrição:' e sem comentários.",
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini Transcribe API Error:", errText);
      return null;
    }

    const data = await response.json();
    const candidate = data.candidates?.[0]?.content?.parts;
    if (Array.isArray(candidate)) {
      const text = candidate
        .map((p: { text?: string }) => p.text || "")
        .join("")
        .trim();
      return text || null;
    }
    return null;
  } catch (err) {
    console.error("Erro ao transcrever com Gemini:", err);
    return null;
  }
}

async function transcribeWithWhisper(file: Blob): Promise<string | null> {
  const apiKey =
    process.env.OPENAI_API_KEY ||
    (globalThis as unknown as { env?: Record<string, string> }).env
      ?.OPENAI_API_KEY;

  if (!apiKey) return null;

  try {
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
      console.warn("OpenAI Whisper Error (tentando fallback):", errorText);
      return null;
    }

    const data = await openAiRes.json();
    return (data.text || "").trim() || null;
  } catch (err) {
    console.warn("Falha na chamada OpenAI Whisper:", err);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return Response.json(
        { error: "Arquivo de áudio não enviado ou inválido." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Prioriza Gemini 3.6 Flash (multimodal nativo sem rate limit 429 da OpenAI)
    let transcript = await transcribeWithGemini(buffer, file.type);

    // 2. Fallback para OpenAI Whisper caso o Gemini não retorne
    if (!transcript) {
      transcript = await transcribeWithWhisper(file);
    }

    if (!transcript) {
      return Response.json(
        {
          error:
            "Não foi possível transcrever o áudio no momento. Verifique as credenciais da IA.",
        },
        { status: 502 },
      );
    }

    return Response.json({
      text: transcript.trim(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("Transcribe Route Error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
