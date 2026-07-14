-- Route A (creator SaaS): prepaid pipeline credits.
--
-- Users buy credit via Stripe Checkout; every provider call debits the
-- balance at cost * margin. Self-hosted deployments never touch these
-- columns (AUTOCONTENT_BILLING_ENABLED defaults false).
alter table users add column credit_balance_usd numeric(10, 4) not null default 0;

create table credit_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users(id) on delete cascade,
    -- Positive = purchase / grant, negative = pipeline debit.
    amount_usd numeric(10, 4) not null,
    kind text not null, -- 'purchase' | 'debit' | 'grant'
    -- Stripe checkout session id for purchases (idempotency key);
    -- job id for debits.
    reference text,
    description text not null default '',
    created_at timestamptz not null default now()
);

create index credit_tx_user_created_idx
    on credit_transactions(user_id, created_at desc);
-- One credit per Stripe checkout session, ever — webhook retries are safe.
create unique index credit_tx_purchase_ref_idx
    on credit_transactions(reference) where kind = 'purchase';
