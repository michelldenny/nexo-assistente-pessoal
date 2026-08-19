# Nexo

Assistente pessoal de finanças e organização, pensado para um único usuário. A primeira fatia do produto reúne dashboard, lançamentos financeiros e uma interface conversacional.

## Escopo

- **MVP:** visão geral, receitas/despesas, categorias, busca e Assistente IA.
- **Fase 2:** contas, cartões, faturas, parcelamentos e recorrências.
- **Fase 3:** agenda, tarefas, projetos e lembretes.
- **Fase 4:** documentos, OCR, busca semântica e importações CSV/OFX/PDF.
- **Fase 5:** WhatsApp como mais um canal do mesmo assistente.

## Decisões principais

- Next.js + TypeScript + Tailwind na interface.
- PostgreSQL/Supabase como banco de produção; o schema está em `db/schema.sql`.
- Gemini API no servidor, usando chamadas de função com argumentos validados.
- Operações de escrita sempre passam por validação de domínio e retornam um recibo auditável.
- Valores monetários são armazenados em centavos, nunca em ponto flutuante.

Veja `docs/ARCHITECTURE.md` para o desenho completo e `docs/AI-FLOW.md` para o fluxo do assistente.

## Rodar localmente

1. Instale as dependências com `npm install`.
2. Inicie com `npm run dev`.
3. Abra `http://localhost:3000`.

A aplicação usa o Gemini como único provedor de IA. As integrações futuras devem preservar os contratos definidos nos documentos e usar o mesmo provedor.
