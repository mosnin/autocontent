-- Postgres cannot drop an enum value in place. Rolling back would require
-- rewriting the type and every dependent column; instead, remap any rows
-- so the value is unused. The enum value itself remains (harmless).
-- Both the column AND the payload snapshot must move: list/get endpoints
-- parse payload->>'status' and would drop rows carrying the unknown value.
update jobs
   set status = 'failed',
       payload = jsonb_set(payload, '{status}', '"failed"'),
       updated_at = now()
 where status = 'rejected';
