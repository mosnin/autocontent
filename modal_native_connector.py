"""Deploy only native OAuth/MCP; leave generation workers on their current release."""

from pathlib import Path
import modal

app = modal.App("marketer-native-connector")
root = Path(__file__).parent
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi>=0.115,<1",
        "pydantic-settings>=2.3,<3",
        "pyjwt[crypto]>=2.9,<3",
        "asyncpg>=0.29,<1",
        "slowapi>=0.1.9,<0.2",
        "httpx>=0.27,<1",
        "python-multipart>=0.0.20,<1",
        "psycopg2-binary>=2.9,<3",
        "yoyo-migrations>=8.2,<10",
    )
    .add_local_dir(str(root / "src/marketer"), "/root/marketer", copy=True)
    .add_local_dir(str(root / "backend"), "/root/backend", copy=True)
    .add_local_file(
        str(root / "db/migrations/0041_oauth_provider.sql"),
        "/root/native-migrations/0041_oauth_provider.sql",
        copy=True,
    )
    .add_local_file(
        str(root / "db/migrations/0041_oauth_provider.rollback.sql"),
        "/root/native-migrations/0041_oauth_provider.rollback.sql",
        copy=True,
    )
)
secrets = [modal.Secret.from_name("marketer-runtime")]


@app.function(
    image=image,
    secrets=secrets,
    max_containers=1,
    timeout=60,
    env={
        "MARKETER_OAUTH_ISSUER": "https://www.marketer.sh",
        "MARKETER_OAUTH_RESOURCE": "https://www.marketer.sh/api/mcp",
    },
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def api():
    from backend.native_connector import create_app

    return create_app()


@app.function(image=image, secrets=secrets, timeout=120)
def migrate_oauth_only():
    import hashlib
    import os
    from urllib.parse import urlsplit, urlunsplit
    from yoyo import get_backend, read_migrations

    raw = os.environ.get("MARKETER_DATABASE_DIRECT_URL") or os.environ["MARKETER_DATABASE_URL"]
    url = urlsplit(raw)
    # Pin this task to the already inspected production account database.
    identity_host = (url.hostname or "").replace("-pooler", "")
    runtime = urlsplit(os.environ["MARKETER_DATABASE_URL"])
    identity = hashlib.sha256((str(runtime.hostname) + runtime.path).encode()).hexdigest()[:16]
    if identity != "aff24f0fdeb55424":
        raise RuntimeError("Database target does not match the inspected production database")
    if url.hostname and url.hostname.endswith(".neon.tech") and "-pooler" in url.hostname:
        raw = urlunsplit(url._replace(netloc=url.netloc.replace(url.hostname, identity_host)))
    backend = get_backend(raw)
    migrations = read_migrations("/root/native-migrations")
    if any(m.id != "0041_oauth_provider" for m in migrations):
        raise RuntimeError("Unexpected migration included")
    with backend.lock():
        pending = backend.to_apply(migrations)
        backend.apply_migrations(pending)
    return {"applied": [m.id for m in pending], "databaseIdentityHash": identity}
