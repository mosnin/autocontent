-- 0033: the workspace's observability content setting (docs/observability/braintrust.md).
--
-- users.observability_content: how much AI text this workspace's traces may
-- carry to the observability provider (Braintrust, and the generic OTLP
-- endpoint when one is set). 'redacted' (the default) exports prompts and
-- outputs after masking; 'metadata' exports no prompt or output text at all,
-- whatever the deployment's BRAINTRUST_CONTENT says. Only security:manage
-- changes it (backend/routes/observability.py), and every change is audited
-- as observability.settings_changed in security_audit_log.

alter table users add column if not exists observability_content text not null default 'redacted'
    check (observability_content in ('redacted', 'metadata'));
alter table users add column if not exists observability_updated_at timestamptz;
