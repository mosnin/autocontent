"""DSN normalization for managed Postgres (Neon / Supabase pooler).

Neon's dashboard hands out URLs with `channel_binding=require` (which asyncpg
rejects as an unknown DSN param) and `-pooler` hosts (pgbouncer transaction
mode, which breaks asyncpg's prepared-statement cache). normalize_dsn must fix
both without touching anything else."""
from __future__ import annotations

from marketer.db import normalize_dsn


def test_strips_channel_binding_keeps_sslmode():
    dsn = (
        "postgresql://neondb_owner:pw@ep-sweet-credit-a1b2c3.us-east-2"
        ".aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    )
    cleaned, pooled = normalize_dsn(dsn)
    assert "channel_binding" not in cleaned
    assert "sslmode=require" in cleaned
    assert cleaned.startswith("postgresql://neondb_owner:pw@ep-sweet-credit")
    assert pooled is False


def test_detects_neon_pooler_host():
    dsn = (
        "postgresql://u:p@ep-sweet-credit-a1b2c3-pooler.us-east-2"
        ".aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    )
    cleaned, pooled = normalize_dsn(dsn)
    assert pooled is True
    assert "channel_binding" not in cleaned


def test_detects_supabase_pooler_host():
    dsn = "postgresql://u:p@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    _, pooled = normalize_dsn(dsn)
    assert pooled is True


def test_plain_local_dsn_untouched():
    dsn = "postgresql://postgres@127.0.0.1:5599/marketer_test"
    cleaned, pooled = normalize_dsn(dsn)
    assert cleaned == dsn
    assert pooled is False


def test_no_query_string_ok():
    cleaned, pooled = normalize_dsn("postgresql://u:p@db.example.com/app")
    assert cleaned == "postgresql://u:p@db.example.com/app"
    assert pooled is False
