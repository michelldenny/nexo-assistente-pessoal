# Fluxo do Assistente IA

## Pipeline

```text
mensagem → contexto mínimo → Responses API → chamada de função
         → validação → serviço de domínio → banco → resultado da função
         → resposta final + recibo auditável
```

## Ferramentas do MVP

- `create_transaction`: cria receita ou despesa.
- `update_transaction`: altera apenas os campos fornecidos.
- `delete_transaction`: exclusão lógica, com capacidade de desfazer.
- `list_transactions`: lista lançamentos com filtros explícitos.
- `summarize_finances`: agrega por período, tipo, conta e categoria.

Fases seguintes adicionam `create_installment_purchase`, `create_calendar_event`, `create_task` e ferramentas de documentos.

## Contrato de exemplo

```json
{
  "name": "create_transaction",
  "strict": true,
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "kind": { "type": "string", "enum": ["expense", "income"] },
      "amount_cents": { "type": "integer", "minimum": 1 },
      "description": { "type": "string" },
      "occurred_on": { "type": "string", "format": "date" },
      "category_id": { "type": ["string", "null"] },
      "account_id": { "type": ["string", "null"] }
    },
    "required": ["kind", "amount_cents", "description", "occurred_on", "category_id", "account_id"]
  }
}
```

## Política de execução

- Criar lançamento simples: executar e mostrar recibo com opção de desfazer.
- Editar ou excluir quando houver ambiguidade: pedir identificação do lançamento.
- Operações em lote, exclusão e valores incomuns: pedir confirmação explícita.
- Nunca inferir moeda, conta ou data quando a ambiguidade muda materialmente o resultado.
- O modelo não calcula saldos; chama `summarize_finances` e explica o resultado.
- Cada tool call guarda argumentos validados, resultado, latência e identificador da conversa.
