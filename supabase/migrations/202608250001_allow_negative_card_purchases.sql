-- 1. Permite valores negativos (estornos, créditos e abatimentos) na tabela de compras de cartão
alter table public.card_purchases drop constraint if exists card_purchases_total_cents_check;
alter table public.card_purchases add constraint card_purchases_total_cents_check check (total_cents <> 0);

-- 2. Remove qualquer trava de valor positivo nas parcelas de cartão
alter table public.card_installments drop constraint if exists card_installments_amount_cents_check;

-- 3. Permite valores não nulos na tabela de transações gerais (caso uma fatura fique com total negativo ou abatida)
alter table public.transactions drop constraint if exists transactions_amount_cents_check;
alter table public.transactions add constraint transactions_amount_cents_check check (amount_cents <> 0);
