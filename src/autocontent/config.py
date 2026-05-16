from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AUTOCONTENT_", env_file=".env", extra="ignore")

    openai_api_key: str = ""
    xai_api_key: str = ""
    ayrshare_api_key: str = ""

    niche: str = ""
    target_duration_sec: int = 45
    scene_count: int = 6
    aspect: str = "9:16"

    # Modal volume mount points
    artifacts_dir: str = "/artifacts"
    assets_dir: str = "/assets"


settings = Settings()
