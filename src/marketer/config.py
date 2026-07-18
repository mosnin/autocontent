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
    # When set, JWT `aud` is verified against this value. Set it in
    # production so tokens minted for another frontend on the same Clerk
    # instance are rejected.
    clerk_audience: str = ""

    aspect: str = "9:16"

    # Model used by every Agents-SDK stage (ideation, scriptwriter,
    # visual director, QA, niche draft). Pinned explicitly so LLM spend
    # is priceable — an SDK default bump would silently change COGS.
    agent_model: str = "gpt-5.4-mini"

    # Article pipeline. The writer model drafts long-form prose (can be a
    # bigger model than agent_model); unset Exa key degrades research to
    # model knowledge instead of failing runs.
    article_writer_model: str = "gpt-5.4-mini"
    exa_api_key: str = ""
    # Skip the hero image stage entirely when False.
    article_hero_image: bool = True

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

    # --- Ads product (paid campaigns) ---------------------------------
    # Master switch. When false, the Ads product is inert: no Composio calls,
    # no Inngest workflows, no spend-affecting actions. Off by default so the
    # feature can ship dark and be enabled per-deploy once keys are set.
    ads_enabled: bool = False
    # Spend-affecting actions whose dollar delta meets/exceeds this threshold
    # require explicit human approval before the safe-execute layer runs them.
    ads_approval_threshold_usd: float = 50.0
    # Composio (agent tool access + per-user OAuth to ad platforms).
    composio_api_key: str = ""
    # Auth config ids per toolkit (created in the Composio dashboard). Empty =
    # that platform can't be connected.
    composio_googleads_auth_config_id: str = ""
    composio_metaads_auth_config_id: str = ""
    # Inngest (durable ad workflows). Keys from the Inngest dashboard; set
    # inngest_dev=True only against a local Inngest dev server.
    inngest_signing_key: str = ""
    inngest_event_key: str = ""
    inngest_dev: bool = False

    # --- Wasabi S3 object storage (media library) ---------------------
    # Durable, S3-compatible home for every produced media artifact (scene
    # clips, keyframes, voiceovers, final videos). Off by default: without
    # a bucket + keys the pipeline keeps working volume-only and the
    # library simply has nothing indexed in object storage.
    wasabi_enabled: bool = False
    # e.g. https://s3.us-east-1.wasabisys.com (region-specific endpoint).
    wasabi_endpoint_url: str = "https://s3.us-east-1.wasabisys.com"
    wasabi_region: str = "us-east-1"
    wasabi_bucket: str = ""
    wasabi_access_key_id: str = ""
    wasabi_secret_access_key: str = ""
    # Presigned playback/download URL lifetime.
    wasabi_presign_expiry_sec: int = 3600

    # --- x402 agent payments (HTTP 402, stablecoin) -------------------
    # Lets agents fund their own prepaid credit over HTTP 402. Off by default;
    # inert without a pay-to address + asset. All facilitator calls are mocked
    # in tests — no real settlement in CI.
    x402_enabled: bool = False
    # CAIP-2 network id (e.g. 'base' / 'eip155:8453') the facilitator settles on.
    x402_network: str = "base"
    # USDC (or other EIP-3009) token contract address on that network.
    x402_asset: str = ""
    # Optional human token metadata for the payment envelope's `extra`.
    x402_asset_name: str = "USDC"
    x402_asset_version: str = "2"
    # The address that receives payment.
    x402_pay_to: str = ""
    # Facilitator base URL (verify + settle). Coinbase CDP or x402.org.
    x402_facilitator_url: str = "https://x402.org/facilitator"
    # Bounds on a single top-up, in USD.
    x402_min_topup_usd: float = 1.0
    x402_max_topup_usd: float = 1000.0

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
