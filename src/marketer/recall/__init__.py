"""Personal and team recall on Supermemory v5 (docs/memory/supermemory.md).

- ``namespace``  the ONE place a Supermemory namespace is derived (from identity).
- ``config``     environment: API key, namespace secret, base URL.
- ``repo``       Postgres: the workspace setting, known personal subjects, the purge
                 queue, the audit cursor and the team mirror state.
- ``service``    what routes and jobs call: scopes from ``AuthCtx``, mirroring.
- ``purge``      the lifecycle job (member removed, account deleted, workspace erased).

The HTTP client is ``marketer.services.supermemory``; it accepts only a
``Scope`` built here, never a namespace string.
"""
