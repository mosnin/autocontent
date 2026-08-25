-- One refund per Stripe checkout session, ever — async_payment_failed
-- retries must not subtract the pack twice.
create unique index credit_tx_refund_ref_idx
    on credit_transactions(reference) where kind = 'refund';
