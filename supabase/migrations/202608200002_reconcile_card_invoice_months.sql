begin;

update public.card_installments as installment
set invoice_month = to_char(
  date_trunc('month', purchase.purchase_date::timestamp)
    + case
        when extract(day from purchase.purchase_date) > card.closing_day
          then interval '1 month'
        else interval '0 month'
      end
    + make_interval(months => installment.installment_number - 1),
  'YYYY-MM'
)
from public.card_purchases as purchase
join public.credit_cards as card on card.id = purchase.card_id
where installment.purchase_id = purchase.id
  and installment.invoice_month is distinct from to_char(
    date_trunc('month', purchase.purchase_date::timestamp)
      + case
          when extract(day from purchase.purchase_date) > card.closing_day
            then interval '1 month'
          else interval '0 month'
        end
      + make_interval(months => installment.installment_number - 1),
    'YYYY-MM'
  );

insert into public.card_invoices (card_id, reference_month)
select distinct card_id, invoice_month
from public.card_installments
on conflict (card_id, reference_month) do nothing;

delete from public.transactions as transaction
using public.card_invoices as invoice
where transaction.invoice_id = invoice.id
  and not exists (
    select 1
    from public.card_installments as installment
    where installment.card_id = invoice.card_id
      and installment.invoice_month = invoice.reference_month
  );

delete from public.card_invoices as invoice
where not exists (
  select 1
  from public.card_installments as installment
  where installment.card_id = invoice.card_id
    and installment.invoice_month = invoice.reference_month
);

update public.card_invoices as invoice
set
  status = case when summary.all_paid then 'paid' else 'open' end,
  paid_at = case
    when summary.all_paid then coalesce(invoice.paid_at, now())
    else null
  end
from (
  select
    card_id,
    invoice_month,
    bool_and(status = 'paid') as all_paid
  from public.card_installments
  group by card_id, invoice_month
) as summary
where invoice.card_id = summary.card_id
  and invoice.reference_month = summary.invoice_month;

insert into public.transactions (
  kind,
  description,
  category,
  amount_cents,
  occurred_on,
  source,
  status,
  invoice_id,
  updated_at
)
select
  'expense',
  'Fatura ' || card.name,
  'Outros',
  sum(installment.amount_cents)::integer,
  (invoice.reference_month || '-' || lpad(card.due_day::text, 2, '0'))::date,
  'manual',
  case when bool_and(installment.status = 'paid') then 'settled' else 'pending' end,
  invoice.id,
  now()
from public.card_invoices as invoice
join public.credit_cards as card on card.id = invoice.card_id
join public.card_installments as installment
  on installment.card_id = invoice.card_id
  and installment.invoice_month = invoice.reference_month
group by invoice.id, invoice.reference_month, card.name, card.due_day
on conflict (invoice_id) do update
set
  description = excluded.description,
  amount_cents = excluded.amount_cents,
  occurred_on = excluded.occurred_on,
  status = excluded.status,
  updated_at = excluded.updated_at;

commit;
