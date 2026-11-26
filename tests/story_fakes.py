"""Fakes for the story video tests: providers that spend, no network."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

from marketer.services.spend_context import SpendContext
from marketer.story.models import StoryStatus, StoryVideo
from marketer.story.providers import ChatResult

CHAT_USD = Decimal("0.010")
IMAGE_USD = Decimal("0.040")
VIDEO_USD = Decimal("0.250")


@dataclass
class FakeProviders:
    calls: list[tuple[str, str]] = field(default_factory=list)
    fail_video_for: set[int] = field(default_factory=set)
    fail_once: bool = True
    references: dict[str, str | None] = field(default_factory=dict)
    scenes: int = 2
    shots_per_scene: int = 2

    async def chat_json(self, *, system: str, user: str, spend: SpendContext, stage: str) -> ChatResult:
        await spend.ensure_can_spend(CHAT_USD)
        self.calls.append(("chat", stage))
        await spend.log(provider="openrouter", sku="llm:fake", units=Decimal(100), cost_usd=CHAT_USD)
        if stage == "story":
            data = {"title": "The Last Espresso", "logline": "A barista saves the morning.", "story": "Scene one. Scene two."}
        elif stage in ("scenes", "revise"):
            tag = "revised" if stage == "revise" else "first"
            data = {"title": "The Last Espresso", "scenes": [
                {"heading": f"INT. CAFE - DAWN {i}", "script": f"{tag} scene {i}: Mia pulls a shot."} for i in range(self.scenes)]}
        elif stage == "characters":
            data = {"characters": [
                {"name": "Mia", "visible": True, "static_features": "short black hair", "dynamic_features": "green apron"},
                {"name": "Narrator", "visible": False, "static_features": "", "dynamic_features": ""},
            ]}
        elif stage == "shots":
            data = {"shots": [
                {"visual": f"<Mia> works {j}", "first_frame": f"Wide shot {j}, <Mia> at the bar", "motion": "slow push-in",
                 "narration": "", "characters": ["Mia", "Ghost"]} for j in range(self.shots_per_scene)]}
        else:
            raise AssertionError(stage)
        return ChatResult(data=data, model="fake")

    async def image(self, prompt: str, out: Path, *, reference: Path | None, aspect: str, spend: SpendContext) -> Path:
        await spend.ensure_can_spend(IMAGE_USD)
        self.calls.append(("image", out.name))
        self.references[out.name] = str(reference) if reference else None
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"png")
        await spend.log(provider="openai", sku="gpt-image-1", units=Decimal(1), cost_usd=IMAGE_USD)
        return out

    async def video(self, keyframe: Path, motion: str, out: Path, *, duration_sec: int, aspect: str, spend: SpendContext) -> Path:
        await spend.ensure_can_spend(VIDEO_USD)
        idx = int(out.name.split("_")[1])
        self.calls.append(("video", out.name))
        if idx in self.fail_video_for:
            if self.fail_once:
                self.fail_video_for.discard(idx)
            raise RuntimeError(f"provider exploded on shot {idx}")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"mp4")
        await spend.log(provider="xai", sku="grok-imagine-video", units=Decimal(duration_sec), cost_usd=VIDEO_USD)
        return out

    def assemble(self, clips: list[Path], out: Path, *, aspect: str) -> Path:
        self.calls.append(("assemble", str(len(clips))))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"final")
        return out

    def image_estimate_usd(self, aspect: str) -> Decimal:
        return IMAGE_USD

    def video_estimate_usd(self, seconds: int) -> Decimal:
        return VIDEO_USD

    def chat_estimate_usd(self) -> Decimal:
        return CHAT_USD

    def count(self, kind: str) -> int:
        return sum(1 for k, _ in self.calls if k == kind)


@dataclass
class Ledger:
    entries: list = field(default_factory=list)

    async def __call__(self, entry) -> None:
        self.entries.append(entry)

    @property
    def total(self) -> Decimal:
        return sum((e.cost_usd for e in self.entries), Decimal(0))


def spend_for(user_id: str, ledger: Ledger, *, global_cap: Decimal | None = None) -> SpendContext:
    async def total(*, user_id: str) -> Decimal:
        return ledger.total

    return SpendContext(user_id=user_id, niche_id=None, job_id=None, record=ledger,
                        global_cap_usd=global_cap, today_total_spend=total if global_cap is not None else None)


def new_story(user_id: str = "user_story", *, mode: str = "idea", status: StoryStatus = StoryStatus.writing) -> StoryVideo:
    return StoryVideo(id=uuid4(), user_id=user_id, mode=mode, source="a barista saves the morning", status=status,
                      stage="script", style="warm film")


def uid() -> UUID:
    return uuid4()
