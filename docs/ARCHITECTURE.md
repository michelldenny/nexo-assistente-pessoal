# Arquitetura do produto

## Visão geral

```text
Web / futuro WhatsApp
        |
   Next.js BFF
   |    |     |
Finanças IA  Agenda/Docs
   |    |     |
 PostgreSQL + Storage
```

O navegador nunca acessa a OpenAI diretamente. Route handlers do Next.js autenticam a sessão, validam a entrada e chamam serviços de domínio. O Assistente IA não escreve SQL: ele escolhe uma função permitida; o servidor valida os argumentos, executa a transação e devolve o resultado ao modelo.

## Módulos e fronteiras

| Módulo | Responsabilidade | Fase |
| --- | --- | --- |
| Dashboard | saldo do mês, receitas, despesas, tendência e últimas movimentações | MVP |
| Financeiro | CRUD de lançamentos, categorias, filtros e análises | MVP |
| Assistente | conversa, seleção de ferramentas, confirmações e histórico | MVP |
| Contas e cartões | contas, cartões, fechamento, vencimento, parcelas e recorrências | 2 |
| Agenda e tarefas | compromissos, lembretes, tarefas e projetos | 3 |
| Documentos | upload, OCR, metadados, chunks, embeddings e busca | 4 |
| Importação | adaptadores idempotentes para CSV, OFX e PDF | 4 |
| Canais | web e WhatsApp reutilizando os mesmos casos de uso | 5 |

## Estrutura-alvo

```text
app/                 rotas, páginas e endpoints
components/          componentes visuais
db/schema.sql        modelo relacional de referência
lib/domain/          regras financeiras e tipos
lib/ai/              prompt, ferramentas e orquestração
lib/repositories/    acesso ao PostgreSQL
docs/                decisões, fluxos e roadmap
```

## Telas do MVP

1. **Visão geral:** saldo, comparativo mensal, receitas/despesas, categorias e últimos lançamentos.
2. **Financeiro:** tabela filtrável, criação/edição/exclusão e detalhe do lançamento.
3. **Assistente:** histórico, sugestões, recibos de ações e opção de desfazer.
4. **Configurações mínimas:** moeda, fuso horário, contas e categorias.

## Regras importantes

- Um único usuário, mas todas as tabelas carregam `user_id` para segurança e evolução.
- Exclusão financeira é lógica (`deleted_at`) e toda mutação gera `audit_events`.
- Idempotency keys impedem duplicidade em mensagens repetidas e importações.
- Datas são guardadas em UTC; a data contábil (`occurred_on`) permanece separada.
- Consultas de análise usam SQL agregado; a IA apenas explica os números retornados.

## Roadmap de implementação

1. Conectar Supabase, autenticação por magic link e migrations.
2. Implementar CRUD financeiro e trocar os dados demonstrativos por queries reais.
3. Ligar o Assistente às ferramentas financeiras e adicionar confirmação/desfazer.
4. Adicionar testes de domínio, contratos das ferramentas e cenários de regressão.
5. Expandir por módulo, sem criar agentes independentes ou duplicar regras.
