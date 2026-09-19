-- 0027: one verbatim knowledge span per user (case-insensitive).
--
-- App-level insert already dedups, but two concurrent extracts of the
-- same rule used to insert twice and bloat every writer prompt. The
-- unique index is the race backstop; duplicates are collapsed first.

delete from company_knowledge a
 using company_knowledge b
 where a.user_id = b.user_id
   and lower(a.span) = lower(b.span)
   and a.ctid > b.ctid;

create unique index if not exists company_knowledge_user_span_uidx
    on company_knowledge (user_id, lower(span));
