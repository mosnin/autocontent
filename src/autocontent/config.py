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

    # Modal volume mount points.
    artifacts_dir: str = "/artifacts"
    assets_dir: str = "/assets"

    # Maximum number of scene-asset tasks running concurrently.
    # Lower values reduce peak spend rate and provider rate-limit exposure.
    scene_fanout_limit: int = 4


settings = Settings()
