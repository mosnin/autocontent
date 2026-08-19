-- Postgres cannot drop an enum value in place. Rolling back would require
-- rewriting the type and every dependent column; instead, remap any rows
-- so the value is unused. The enum value itself remains (harmless).
update jobs set status = 'failed', updated_at = now() where status = 'rejected';
