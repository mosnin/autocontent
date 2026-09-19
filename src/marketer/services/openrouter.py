"""OpenRouter: per-niche scriptwriter model choice.

OpenRouter speaks the OpenAI chat-completions dialect, so the Agents SDK
runs any of its models through `OpenAIChatCompletionsModel` with a
re-based AsyncOpenAI client. Config-gated on `MARKETER_OPENROUTER_API_KEY`;
an empty `niche.script_model` (or missing key) keeps the stock
`settings.agent_model` path untouched.

Pricing is a curated registry (USD per million tokens, from OpenRouter's
published rates at integration time) so every scripted video's LLM spend
lands in spend_ledger with the real model as the SKU — same contract as
every other provider.
"""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel

from ..config import settings

PROVIDER = "openrouter"
BASE_URL = "https://openrouter.ai/api/v1"


class ScriptModel(BaseModel):
    id: str          # OpenRouter model id, e.g. "anthropic/claude-sonnet-4.5"
    name: str        # display name for the UI dropdown
    tagline: str
    usd_per_m_input: Decimal
    usd_per_m_output: Decimal


# Curated writer models. Prices per 1M tokens.
# Qwen leads: the Jev harness routes generation here by default. Other
# frontier writers stay available for per-niche overrides.
OPENROUTER_MODELS: list[ScriptModel] = [
    ScriptModel(
        id="qwen/qwen3-8b",
        name="Qwen3 8B",
        tagline="Fast Qwen tier — lookups, extraction, localized edits",
        usd_per_m_input=Decimal("0.05"),
        usd_per_m_output=Decimal("0.20"),
    ),
    ScriptModel(
        id="qwen/qwen3-32b",
        name="Qwen3 32B",
        tagline="Default generation model — scripts and article sections",
        usd_per_m_input=Decimal("0.10"),
        usd_per_m_output=Decimal("0.30"),
    ),
    ScriptModel(
        id="qwen/qwen3-235b-a22b",
        name="Qwen3 235B",
        tagline="Powerful Qwen tier — strategy and high-stakes copy",
        usd_per_m_input=Decimal("0.30"),
        usd_per_m_output=Decimal("1.20"),
    ),
    ScriptModel(
        id="anthropic/claude-sonnet-4.5",
        name="Claude Sonnet 4.5",
        tagline="Exceptional voice control and nuance",
        usd_per_m_input=Decimal("3.00"),
        usd_per_m_output=Decimal("15.00"),
    ),
    ScriptModel(
        id="openai/gpt-5.4",
        name="GPT-5.4",
        tagline="Strong all-round writing",
        usd_per_m_input=Decimal("1.75"),
        usd_per_m_output=Decimal("14.00"),
    ),
    ScriptModel(
        id="google/gemini-2.5-pro",
        name="Gemini 2.5 Pro",
        tagline="Long-context, detail-dense scripts",
        usd_per_m_input=Decimal("1.25"),
        usd_per_m_output=Decimal("10.00"),
    ),
    ScriptModel(
        id="deepseek/deepseek-chat-v3.1",
        name="DeepSeek V3.1",
        tagline="Budget writer with surprising punch",
        usd_per_m_input=Decimal("0.27"),
        usd_per_m_output=Decimal("1.10"),
    ),
    ScriptModel(
        id="meta-llama/llama-4-maverick",
        name="Llama 4 Maverick",
        tagline="Open-weights, fast and cheap",
        usd_per_m_input=Decimal("0.20"),
        usd_per_m_output=Decimal("0.85"),
    ),
]

_BY_ID = {m.id: m for m in OPENROUTER_MODELS}
_openai_client = None


def enabled() -> bool:
    return bool(settings.openrouter_api_key)


def get_model(model_id: str) -> ScriptModel | None:
    if not isinstance(model_id, str):
        raise TypeError("model_id must be a string")
    return _BY_ID.get(model_id)


def generation_metered(agent, model_id: str = "") -> dict:
    """Route an Agents-SDK writer through OpenRouter/Qwen when live.

    Mutates ``agent.model`` and returns kwargs for ``run_metered``.
    Off / unknown id / stock ``agent_model`` → empty dict (no change).
    Scriptwriter, Visual Director, and the leftover ideation writer
    share this so a missing key cannot silently split fleets.
    """
    if agent is None:
        raise TypeError("agent is required")
    if not isinstance(model_id, str):
        raise TypeError("model_id must be a string")
    from ..jev.harness import default_generation_model

    chosen = model_id.strip() or default_generation_model()
    or_model = get_model(chosen)
    if or_model is None or not enabled() or chosen == settings.agent_model:
        return {}
    agent.model = agents_model(chosen)
    return {
        "provider": PROVIDER,
        "sku": f"llm:{chosen}",
        "cost_fn": lambda i, o, m=or_model: llm_cost(m, i, o),
    }


def llm_cost(model: ScriptModel, input_tokens: int, output_tokens: int) -> Decimal:
    cost = (
        model.usd_per_m_input * Decimal(input_tokens)
        + model.usd_per_m_output * Decimal(output_tokens)
    ) / Decimal(1_000_000)
    return cost.quantize(Decimal("0.000001"))


def chat_client():
    """Shared OpenRouter OpenAI-compatible client (keep-alive)."""
    from openai import AsyncOpenAI

    global _openai_client
    if not enabled():
        raise RuntimeError("MARKETER_OPENROUTER_API_KEY is not set")
    if _openai_client is None:
        _openai_client = AsyncOpenAI(
            base_url=BASE_URL, api_key=settings.openrouter_api_key
        )
    return _openai_client


def agents_model(model_id: str):
    """An Agents-SDK model object routing through OpenRouter.

    Raises for unknown ids or missing key — callers gate on `enabled()`
    and registry membership before selecting this path."""
    if not enabled():
        raise RuntimeError("MARKETER_OPENROUTER_API_KEY is not set")
    if model_id not in _BY_ID:
        raise ValueError(f"unknown openrouter model {model_id!r}")

    from agents import OpenAIChatCompletionsModel

    return OpenAIChatCompletionsModel(
        model=model_id, openai_client=chat_client()
    )
