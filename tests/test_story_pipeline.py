"""Story video orchestration with fake providers: stages, consistency
references, resume after a failed shot, metering in micro-dollars with
idempotency keys, and the caps."""
from __future__ import annotations

from decimal import Decimal

import pytest

from marketer.repos.spend import SpendCapExceeded
from marketer.story import pipeline
from marketer.story.meter import StoryCapExceeded, StoryMeter
from marketer.story.models import Charge, StoryStatus, key_clip, micros_to_usd, usd_to_micros
from marketer.story.settings import story_settings
from marketer.story.store import InMemoryStoryStore
from tests.story_fakes import CHAT_USD, IMAGE_USD, VIDEO_USD, FakeProviders, Ledger, new_story, spend_for


@pytest.fixture
def store():
    return InMemoryStoryStore()


async def _run(store, story, stage, prov, ledger, tmp_path, arg=None, **kw):
    return await pipeline.run_stage(story.id, user_id=story.user_id, stage=stage, arg=arg, store=store, providers=prov,
                                    spend=spend_for(story.user_id, ledger, **kw), root=tmp_path)


async def _through_storyboard(store, prov, ledger, tmp_path):
    story = await store.create(new_story())
    s = await _run(store, story, "script", prov, ledger, tmp_path)
    assert s.status == StoryStatus.script_ready, s.error
    await store.update(story.id, user_id=story.user_id, status=StoryStatus.boarding)
    s = await _run(store, story, "storyboard", prov, ledger, tmp_path)
    assert s.status == StoryStatus.storyboard_ready, s.error
    return s


def test_micros_are_integers_rounded_half_up():
    assert usd_to_micros(Decimal("0.0000005")) == 1
    assert usd_to_micros("0.25") == 250_000
    assert isinstance(usd_to_micros(Decimal("1.2345678")), int)
    assert micros_to_usd(1_234_568) == Decimal("1.234568")
    with pytest.raises(ValueError):
        usd_to_micros(Decimal("-1"))


async def test_idea_to_video_runs_every_stage(store, tmp_path):
    prov, ledger = FakeProviders(), Ledger()
    s = await _through_storyboard(store, prov, ledger, tmp_path)
    assert [st for k, st in prov.calls if k == "chat"] == ["story", "scenes", "characters", "shots", "shots"]
    assert s.title == "The Last Espresso"
    assert len(s.plan.scenes) == 2 and len(s.plan.shots) == 4
    assert [c.name for c in s.plan.characters] == ["Mia", "Narrator"]
    # Unknown names from the model are dropped; only listed characters stay.
    assert s.plan.shots[0].characters == ["Mia"]
    # One portrait (the invisible narrator gets none) + four frames.
    assert prov.count("image") == 5
    # Consistency: every frame is drawn against Mia's reference portrait.
    frame_refs = {k: v for k, v in prov.references.items() if k.startswith("shot_")}
    assert frame_refs and all(v and v.endswith("mia.png") for v in frame_refs.values())
    assert s.estimate_micros == 4 * usd_to_micros(VIDEO_USD)

    await store.update(s.id, user_id=s.user_id, status=StoryStatus.rendering)
    done = await _run(store, s, "render", prov, ledger, tmp_path)
    assert done.status == StoryStatus.done, done.error
    assert done.video_path and done.video_path.endswith("story_r0.mp4")
    assert prov.count("video") == 4 and prov.count("assemble") == 1
    expected = 5 * CHAT_USD + 5 * IMAGE_USD + 4 * VIDEO_USD
    assert ledger.total == expected
    assert done.spent_micros == usd_to_micros(expected)
    assert all(isinstance(c.cost_micros, int) for c in await store.charges(s.id))


async def test_script_mode_skips_the_story_stage(store, tmp_path):
    prov, ledger = FakeProviders(), Ledger()
    story = await store.create(new_story(mode="script"))
    s = await _run(store, story, "script", prov, ledger, tmp_path)
    assert s.status == StoryStatus.script_ready
    assert [st for _, st in prov.calls] == ["scenes"]


async def test_failed_shot_resumes_without_redoing_or_recharging(store, tmp_path):
    prov, ledger = FakeProviders(fail_video_for={2}), Ledger()
    s = await _through_storyboard(store, prov, ledger, tmp_path)
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.rendering)
    failed = await _run(store, s, "render", prov, ledger, tmp_path)
    assert failed.status == StoryStatus.failed and failed.stage == "render"
    assert "shot 2" in failed.error
    rendered_before = prov.count("video")
    charged_before = ledger.total

    await store.update(s.id, user_id=s.user_id, status=StoryStatus.rendering)
    done = await _run(store, s, "render", prov, ledger, tmp_path)
    assert done.status == StoryStatus.done, done.error
    # Only the failed shot is sent again; no frame, portrait or text is redone.
    assert prov.count("video") == rendered_before + 1
    assert prov.count("image") == 5 and prov.count("chat") == 5
    assert ledger.total == charged_before + VIDEO_USD


async def test_lost_checkpoint_replay_is_never_charged_twice(store, tmp_path):
    """A worker that crashed after the provider charged but before the
    checkpoint landed replays the unit: the charge key already exists."""
    prov, ledger = FakeProviders(), Ledger()
    s = await _through_storyboard(store, prov, ledger, tmp_path)
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.rendering)
    await _run(store, s, "render", prov, ledger, tmp_path)
    total = ledger.total
    shot = s.plan.shots[1]
    del store.cps[s.id][key_clip(s.revision, shot)]
    store.cps[s.id] = {k: v for k, v in store.cps[s.id].items() if not k.startswith("final:")}
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.rendering)
    again = await _run(store, s, "render", prov, ledger, tmp_path)
    assert again.status == StoryStatus.done
    assert prov.count("video") == 5  # the provider ran again...
    assert ledger.total == total  # ...but the workspace was not charged again
    keys = [c.idempotency_key for c in await store.charges(s.id)]
    assert len(keys) == len(set(keys))


async def test_regenerate_one_shot_draws_only_that_frame(store, tmp_path):
    prov, ledger = FakeProviders(), Ledger()
    s = await _through_storyboard(store, prov, ledger, tmp_path)
    shots = list(s.plan.shots)
    shots[3] = shots[3].model_copy(update={"frame_rev": 1, "first_frame": "Close-up of <Mia>'s hands"})
    await store.update(s.id, user_id=s.user_id, plan=s.plan.model_copy(update={"shots": shots}), status=StoryStatus.boarding)
    out = await _run(store, s, "frame", prov, ledger, tmp_path, arg="3")
    assert out.status == StoryStatus.storyboard_ready
    assert prov.count("image") == 6 and prov.calls[-1] == ("image", "shot_3_1.png")


async def test_revise_bumps_revision_and_uses_the_note(store, tmp_path):
    prov, ledger = FakeProviders(), Ledger()
    story = await store.create(new_story())
    await _run(store, story, "script", prov, ledger, tmp_path)
    out = await _run(store, story, "revise", prov, ledger, tmp_path, arg="make it funnier")
    assert out.revision == 1 and out.plan.scenes[0].script.startswith("revised")


async def test_story_ceiling_stops_before_the_call(store, tmp_path, monkeypatch):
    monkeypatch.setattr(story_settings, "max_usd", Decimal("0.20"))
    prov, ledger = FakeProviders(), Ledger()
    story = await store.create(new_story())
    await _run(store, story, "script", prov, ledger, tmp_path)
    await store.update(story.id, user_id=story.user_id, status=StoryStatus.boarding)
    out = await _run(store, story, "storyboard", prov, ledger, tmp_path)
    assert out.status == StoryStatus.failed
    assert out.error.startswith("Stopped at a spend limit")
    assert out.spent_micros <= usd_to_micros(Decimal("0.20"))


async def test_global_cap_stops_the_render(store, tmp_path):
    prov, ledger = FakeProviders(), Ledger()
    s = await _through_storyboard(store, prov, ledger, tmp_path)
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.rendering)
    out = await _run(store, s, "render", prov, ledger, tmp_path, global_cap=ledger.total + Decimal("0.30"))
    assert out.status == StoryStatus.failed and "spend limit" in out.error
    assert prov.count("assemble") == 0


async def test_meter_refuses_spend_outside_a_unit(store):
    meter = StoryMeter(store=store, story_id=new_story().id, user_id="u", base=spend_for("u", Ledger()))
    with pytest.raises(RuntimeError):
        await meter.spend.log(provider="x", sku="y", units=Decimal(1), cost_usd=Decimal("0.1"))


async def test_meter_ceiling_raises_a_spend_cap_error(store):
    story = await store.create(new_story())
    meter = StoryMeter(store=store, story_id=story.id, user_id=story.user_id, base=spend_for(story.user_id, Ledger()),
                       spent_micros=900_000, ceiling_micros=1_000_000)
    with pytest.raises(StoryCapExceeded) as exc:
        await meter.spend.ensure_can_spend(Decimal("0.2"))
    assert isinstance(exc.value, SpendCapExceeded) and exc.value.scope == "story"


async def test_store_charge_keys_are_unique_per_workspace(store):
    story = await store.create(new_story())
    c = Charge(story_id=story.id, user_id=story.user_id, idempotency_key="k", stage="clip", provider="xai", sku="v", cost_micros=5)
    assert await store.record_charge(c) is True
    assert await store.record_charge(c) is False
    assert (await store.get(story.id, user_id=story.user_id)).spent_micros == 5
