from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MARKETER_", env_file=".env", extra="ignore")

    openai_api_key: str = ""
    xai_api_key: str = ""
    ayrshare_api_key: str = ""
    pixabay_api_key: str = ""

    # Supabase Postgres (use the pooler URL for the runtime app).
    database_url: str = ""

    # Clerk JWT verification.
    clerk_jwks_url: str = ""
    clerk_issuer: str = ""

    aspect: str = "9:16"

    # Comma-separated list of origins allowed by the FastAPI CORS middleware.
    # If empty/unset we fall back to "*" with credentials disabled.
    web_origin: str = ""

    # When set, slowapi uses this Redis URL for distributed rate-limit storage.
    # Leave empty to fall back to in-process memory (fine for single-instance).
    rate_limit_redis_url: str = ""

    # Modal volume mount points.
    artifacts_dir: str = "/artifacts"
    assets_dir: str = "/assets"

    # Maximum number of scene-asset tasks running concurrently.
    # Lower values reduce peak spend rate and provider rate-limit exposure.
    scene_fanout_limit: int = 4

    # Concurrency controls for the nightly batch scheduler.
    # pipeline_global_concurrency is passed to Modal's concurrency_limit on
    # run_pipeline — it caps the total number of live containers across the
    # entire deployment.
    pipeline_global_concurrency: int = 20
    # Maximum number of run_pipeline jobs active at once for a single user.
    pipeline_per_user_concurrency: int = 3
    # Maximum number of run_pipeline jobs active at once for a single niche.
    # Use 1 to serialize per-niche (avoids character-sheet write races).
    pipeline_per_niche_concurrency: int = 1

    # Sentry error reporting. Set sentry_dsn to enable; leave empty to disable.
    sentry_dsn: str = ""
    sentry_environment: str = "production"
    sentry_traces_sample_rate: float = 0.0

    # Ayrshare webhook HMAC secret. Must be set to accept webhook deliveries.
    ayrshare_webhook_secret: str = ""

    # --- Hosted product (Route A) -------------------------------------
    # When true, pipeline spend requires prepaid credit and debits it at
    # cost * billing_margin. Self-hosted deploys leave this false and
    # nothing changes.
    billing_enabled: bool = False
    billing_margin: float = 1.5
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    # Public origin for checkout redirects + email links,
    # e.g. https://app.marketer.dev
    app_url: str = ""

    # Transactional email (Resend). Empty key = emails silently skipped.
    resend_api_key: str = ""
    email_from: str = "marketer <notifications@marketer.dev>"

    # OpenTelemetry tracing. Leave otel_exporter_otlp_endpoint empty to
    # disable OTEL entirely (all instrumentation becomes a no-op).
    # Example endpoints:
    #   Honeycomb:  https://api.honeycomb.io/
    #   Axiom:      https://api.axiom.co/
    #   Datadog:    https://otlp.datadoghq.com/ (OTLP/HTTP)
    #   Grafana Tempo: http://localhost:4318/
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = "marketer-sh"
    # Comma-separated key=value pairs for OTLP auth headers, e.g.
    #   x-honeycomb-team=<key>
    #   x-axiom-dataset=marketer,authorization=Bearer <token>
    otel_exporter_otlp_headers: str = ""
    otel_traces_sample_rate: float = 1.0


settings = Settings()
