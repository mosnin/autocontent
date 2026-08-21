-- Idempotent refund rows so Stripe webhook retries (and a later
-- charge.refunded after charge.dispute.created) cannot reverse a pack twice.
-- IF NOT EXISTS so this is safe if another branch already created the index.
create unique index if not exists credit_tx_refund_ref_idx
    on credit_transactions(reference) where kind = 'refund';
