from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AUTOCONTENT_", env_file=".env", extra="ignore")

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


settings = Settings()
