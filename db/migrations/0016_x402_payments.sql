-- 0016: x402 agent payments — record each settled on-chain payment that funded
-- a user's prepaid credit, so crediting is idempotent on the settlement id and
-- we keep an auditable trail of agent-funded top-ups.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists x402_payments (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    -- Facilitator settlement / transaction id. Unique => idempotent crediting
    -- even if the client retries the settle call.
    settlement_id  text not null,
    payer          text not null default '',
    amount_usd     numeric(12, 2) not null,
    network        text not null default '',
    asset          text not null default '',
    credited       boolean not null default false,
    created_at     timestamptz not null default now(),
    unique (settlement_id)
);
create index if not exists x402_payments_user_idx on x402_payments (user_id, created_at desc);
