-- Permite valores negativos (estornos, creditos e abatimentos) em compras de cartao de credito
alter table public.card_purchases drop constraint if exists card_purchases_total_cents_check;
alter table public.card_purchases add constraint card_purchases_total_cents_check check (total_cents <> 0);
