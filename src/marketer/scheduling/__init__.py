"""First-class scheduled-post queue for *user-authored* content.

The rest of the platform schedules content the pipeline produced: a video
job renders, then `services/scheduler.py` hands it to Ayrshare at the
niche's next posting window. That path is generation-first — there is no
way for a user to say "post this copy, with this media I already have, on
Thursday at 09:00, to Instagram and TikTok, with a different caption on
LinkedIn".

This package is that missing queue:

- `schemas`   — ScheduledPost / PlatformVariant / RecurringSlot models,
                platform normalisation, and input validation.
- `slots`     — expansion of recurring weekly slots (authored in a user's
                local timezone) into concrete UTC instants, DST-safe.
- `dispatch`  — due-post selection, atomic claim, per-platform publish
                through the existing Ayrshare service, idempotent.
- `importer`  — bulk CSV import with per-row validation and an error
                report (all-or-nothing: nothing is written if any row is
                bad, so fixing the file and re-uploading can't duplicate).

Persistence lives in `marketer.repos.scheduled_posts`; the HTTP surface in
`backend.routes.scheduled_posts`.
"""
from __future__ import annotations

__all__ = ["dispatch", "importer", "schemas", "slots"]
