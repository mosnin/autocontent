"""Image-post pipeline + template remix units (providers/repos mocked)."""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from marketer.agents.carousel import CarouselPlan, CarouselSlide
from marketer.models import Niche, PostingWindow, Template, User
from marketer.services import image_posts as svc

USER = "user_img"
NICHE_ID = UUID("00000000-0000-0000-0000-00000000f00d")
POST_ID = UUID("00000000-0000-0000-0000-00000000beef")


def _niche(**over) -> Niche:
    base = dict(
        id=NICHE_ID, user_id=USER, title="claude tips", description="d",
        target_audience="devs", visual_style="clean diagram style", voice="onyx",
        target_duration_sec=30, scene_count=2,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["reels"], daily_spend_cap_usd=Decimal(5),
    )
    base.update(over)
    return Niche(**base)


def _plan(n=3) -> CarouselPlan:
    return CarouselPlan(
        slides=[
            CarouselSlide(index=i, heading=f"h{i}", body=f"b{i}",
                          visual_prompt=f"slide {i} diagram")
            for i in range(n)
        ],
        caption="Hook line\nvalue line",
        hashtags=["claude"],
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.repos import image_posts as repo
    from marketer.repos import niches as niches_repo
    from marketer.services import media_archive

    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))

    state = {
        "post": {
            "id": POST_ID, "user_id": USER, "niche_id": NICHE_ID,
            "kind": "carousel", "topic": "how to use hooks in Claude Code",
            "status": "queued", "payload": {"slide_count": 3},
        },
        "niche": _niche(),
        "statuses": [],
        "saved_payload": None,
        "posted": None,
        "gen_calls": [],
    }

    async def fake_get(pid, *, user_id):
        return state["post"]

    async def fake_set_status(pid, *, user_id, status):
        state["statuses"].append(status)
        state["post"] = {**state["post"], "status": status}
        return state["post"]

    async def fake_save_payload(pid, *, user_id, payload):
        state["saved_payload"] = payload
        state["post"] = {**state["post"], "payload": payload}
        return state["post"]

    async def fake_complete(pid, *, user_id, provider_post_id):
        state["post"] = {**state["post"], "status": "done",
                         "provider_post_id": provider_post_id}
        return state["post"]

    async def fake_fail(pid, *, user_id, error):
        state["post"] = {**state["post"], "status": "failed", "error": error}
        return state["post"]

    monkeypatch.setattr(repo, "get", fake_get)
    monkeypatch.setattr(repo, "set_status", fake_set_status)
    monkeypatch.setattr(repo, "save_payload", fake_save_payload)
    monkeypatch.setattr(repo, "complete", fake_complete)
    monkeypatch.setattr(repo, "fail", fake_fail)

    async def fake_niche_get(nid, *, user_id):
        return state["niche"]

    monkeypatch.setattr(niches_repo, "get", fake_niche_get)

    async def fake_default_context(**kwargs):
        assert kwargs.get("image_post_id") == POST_ID  # attribution wired

    monkeypatch.setattr(svc, "default_context", fake_default_context)
    monkeypatch.setattr(svc, "ensure_layout", lambda p: tmp_path / p)

    async def fake_user_get(user_id):
        return User(id=user_id, email="x@y.z", ayrshare_profile_key="pk-img")

    monkeypatch.setattr(svc.users_repo, "get", fake_user_get)

    async def fake_plan(**kwargs):
        return _plan(3)

    monkeypatch.setattr(svc, "_plan", fake_plan)

    from marketer.services import openai_images

    async def fake_keyframe(prompt, out_path, *, quality,
                            reference_image_path=None, spend=None):
        state["gen_calls"].append((prompt, reference_image_path))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
        return out_path

    monkeypatch.setattr(openai_images, "generate_keyframe", fake_keyframe)

    async def fake_archive(**kwargs):
        return len(kwargs.get("slide_paths", []))

    monkeypatch.setattr(media_archive, "archive_image_slides", fake_archive)

    async def fake_poster(**kwargs):
        state["posted"] = kwargs
        return "ayr-post-1"

    state["poster"] = fake_poster
    return state


async def test_carousel_flow_slide1_is_reference_and_posts(env):
    result = await svc.run_image_post(
        user_id=USER, image_post_id=POST_ID, apply_schedule=env["poster"],
    )
    assert result["status"] == "done"
    assert result["provider_post_id"] == "ayr-post-1"
    # slide 0 generated without reference; slides 1..n against slide 0
    refs = [r for _, r in env["gen_calls"]]
    assert refs[0] is None
    assert refs[1] is not None and refs[1] == refs[2]
    assert refs[1].name == "slide_0.png"
    # posted all three slides with the plan caption
    assert len(env["posted"]["image_paths"]) == 3
    assert env["posted"]["caption"].startswith("Hook line")
    assert "planning" in env["statuses"] and "generating" in env["statuses"]


async def test_run_image_post_mismatch_niche_fail_closes(env):
    other = uuid4()
    with pytest.raises(ValueError, match="niche mismatch"):
        await svc.run_image_post(
            user_id=USER,
            image_post_id=POST_ID,
            apply_schedule=env["poster"],
            niche_id=other,
        )


async def test_schedule_image_post_mismatch_niche_fail_closes(env):
    env["post"] = {
        **env["post"],
        "payload": {
            "caption": "Hook line",
            "hashtags": ["claude"],
            "slides": [{"index": 0, "heading": "h0", "path": "/tmp/s0.png"}],
        },
    }
    other = uuid4()
    with pytest.raises(ValueError, match="niche mismatch"):
        await svc.schedule_image_post(
            user_id=USER,
            image_post_id=POST_ID,
            apply_schedule=env["poster"],
            niche_id=other,
        )


async def test_run_image_post_gathers_when_niche_id_passed(env):
    result = await svc.run_image_post(
        user_id=USER,
        image_post_id=POST_ID,
        apply_schedule=env["poster"],
        niche_id=NICHE_ID,
    )
    assert result["status"] == "done"


async def test_schedule_reuses_loaded_post_and_niche(env, monkeypatch):
    from marketer.repos import image_posts as repo
    from marketer.repos import niches as niches_repo

    env["post"] = {
        **env["post"],
        "payload": {
            "caption": "Hook line",
            "hashtags": ["claude"],
            "slides": [{"index": 0, "heading": "h0", "path": "/tmp/s0.png"}],
        },
    }

    async def boom_get(*_a, **_k):
        raise AssertionError("schedule must not reload post when it is passed in")

    async def boom_niche(*_a, **_k):
        raise AssertionError("schedule must not reload niche when it is passed in")

    monkeypatch.setattr(repo, "get", boom_get)
    monkeypatch.setattr(svc.image_posts_repo, "get", boom_get)
    monkeypatch.setattr(niches_repo, "get", boom_niche)
    monkeypatch.setattr(svc.niches_repo, "get", boom_niche)

    result = await svc.schedule_image_post(
        user_id=USER,
        image_post_id=POST_ID,
        apply_schedule=env["poster"],
        post=env["post"],
        niche=env["niche"],
    )
    assert result["status"] == "done"
    assert env["posted"] is not None
    assert env["posted"]["profile_key"] == "pk-img"


async def test_schedule_gathers_status_and_user(env, monkeypatch):
    """set_status(scheduling) and users.get used to be sequential."""
    import asyncio

    env["post"] = {
        **env["post"],
        "payload": {
            "caption": "Hook line",
            "hashtags": ["claude"],
            "slides": [{"index": 0, "heading": "h0", "path": "/tmp/s0.png"}],
        },
    }

    started = 0
    max_inflight = 0
    inflight = 0
    release = asyncio.Event()

    from marketer.repos import image_posts as repo

    async def slow_set_status(*a, **k):
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        n = started
        if n < 2:
            await release.wait()
        else:
            release.set()
        inflight -= 1
        env["statuses"].append(k["status"])
        env["post"] = {**env["post"], "status": k["status"]}
        return env["post"]

    async def slow_user_get(user_id):
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        n = started
        if n < 2:
            await release.wait()
        else:
            release.set()
        inflight -= 1
        return User(id=user_id, email="x@y.z", ayrshare_profile_key="pk-sched")

    monkeypatch.setattr(svc.image_posts_repo, "set_status", slow_set_status)
    monkeypatch.setattr(repo, "set_status", slow_set_status)
    monkeypatch.setattr(svc.users_repo, "get", slow_user_get)

    result = await svc.schedule_image_post(
        user_id=USER,
        image_post_id=POST_ID,
        apply_schedule=env["poster"],
        post=env["post"],
        niche=env["niche"],
    )
    assert result["status"] == "done"
    assert started == 2
    assert max_inflight == 2
    assert env["posted"]["profile_key"] == "pk-sched"


async def test_approval_gate_parks_image_post(env):
    env["niche"] = _niche(approve_before_post=True)
    result = await svc.run_image_post(
        user_id=USER, image_post_id=POST_ID, apply_schedule=env["poster"],
    )
    assert result["status"] == "awaiting_approval"
    assert env["posted"] is None  # never posted


async def test_generation_failure_is_terminal_not_zombie(env, monkeypatch):
    from marketer.services import openai_images

    async def boom(*a, **k):
        raise RuntimeError("image provider down")

    monkeypatch.setattr(openai_images, "generate_keyframe", boom)
    result = await svc.run_image_post(
        user_id=USER, image_post_id=POST_ID, apply_schedule=env["poster"],
    )
    assert result["status"] == "failed"
    assert "image provider down" in result["error"]


async def test_plan_is_always_template(monkeypatch):
    """Dark-path carousels must not buy a planner LLM."""
    from agents import Runner

    async def boom(*a, **k):
        raise AssertionError("carousel plan is a template, not a writer")

    monkeypatch.setattr(Runner, "run", boom)
    plan = await svc._plan(
        topic="claude tips",
        kind="carousel",
        slide_count=3,
        niche=_niche(),
        spend=None,  # type: ignore[arg-type]
    )
    assert len(plan.slides) == 3
    assert plan.slides[0].index == 0
    assert "claude tips" in plan.slides[0].heading.lower() or plan.caption


async def test_plan_strips_invented_stats(monkeypatch):
    """Caption facts the niche brief does not contain are stripped."""

    def fake_template(**kwargs):
        return CarouselPlan(
            slides=[
                CarouselSlide(
                    index=0,
                    heading="We save 47%. Next step.",
                    body="Study shows 2024. Do this.",
                    visual_prompt="diagram",
                )
            ],
            caption="Research shows 99% of marketers fail. Do this next.",
            hashtags=["claude"],
        )

    monkeypatch.setattr(svc, "template_carousel_plan", fake_template)
    plan = await svc._plan(
        topic="claude tips",
        kind="single",
        slide_count=1,
        niche=_niche(),
        spend=None,  # type: ignore[arg-type]
    )
    assert "99%" not in plan.caption
    assert "Do this next" in plan.caption
    assert "47%" not in plan.slides[0].heading
    assert "Next step" in plan.slides[0].heading
    assert "2024" not in plan.slides[0].body
    assert "Do this" in plan.slides[0].body


# --------------------------------------------------------------------------- remix

async def test_template_remix_uses_both_references(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.repos import media as media_repo
    from marketer.repos import templates as templates_repo
    from marketer.services import openai_images, template_remix

    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))

    ref = tmp_path / "templates" / "ref.png"
    ref.parent.mkdir(parents=True)
    ref.write_bytes(b"REF")
    product = tmp_path / "product.png"
    product.write_bytes(b"PROD")

    template = Template(
        id=uuid4(), kind="image", name="UGC desk shot",
        prompt="cozy desk product shot, warm window light",
        reference_key=str(ref), is_published=True, created_by="admin",
    )

    async def fake_get(tid):
        return template

    monkeypatch.setattr(templates_repo, "get", fake_get)

    async def fake_ctx(**kwargs):
        assert kwargs["niche_id"] is None  # niche-less spend context

    monkeypatch.setattr(template_remix, "default_context", fake_ctx)

    remix_calls = []

    async def fake_remix(prompt, out, *, reference_paths, quality="medium",
                         size="1024x1024", spend=None):
        remix_calls.append((prompt, list(reference_paths)))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"OUT")
        return out

    monkeypatch.setattr(openai_images, "generate_remix", fake_remix)

    recorded = []

    async def fake_record(**kwargs):
        recorded.append(kwargs)
        from marketer.models import MediaAsset
        return MediaAsset(id=uuid4(), user_id=USER, kind="keyframe",
                          storage="volume", object_key=kwargs["object_key"])

    monkeypatch.setattr(media_repo, "record_asset", fake_record)

    result = await template_remix.run_remix(
        user_id=USER, template_id=template.id,
        product_path=str(product), count=2,
    )
    assert result["status"] == "done" and result["generated"] == 2
    prompt, refs = remix_calls[0]
    assert refs == [ref, product]  # template look + user product, in order
    assert "Replace the featured product" in prompt
    assert template.prompt in prompt
    assert len(recorded) == 2
    assert recorded[0]["title"].startswith("Remix: UGC desk shot")


async def test_remix_refuses_unpublished_template(monkeypatch):
    from marketer.repos import templates as templates_repo
    from marketer.services import template_remix

    async def fake_get(tid):
        return Template(
            id=uuid4(), kind="image", name="draft", prompt="p",
            is_published=False, created_by="admin",
        )

    monkeypatch.setattr(templates_repo, "get", fake_get)

    async def fake_ctx(**kwargs):
        return None

    monkeypatch.setattr(template_remix, "default_context", fake_ctx)
    result = await template_remix.run_remix(
        user_id=USER, template_id=uuid4(), count=1,
    )
    assert result["status"] == "failed"
