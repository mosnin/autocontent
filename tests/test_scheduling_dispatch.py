"""Dispatch loop: the double-post guards.

Double-posting to a user's real social account is the worst failure this
feature has, so most of this file is about *not* publishing. Three
independent guards are exercised separately, because each one covers a
case the others do not:

1. `claim_due` — the per-post atomic status claim. Two dispatcher passes
   on the same tick: only one gets the post.
2. `claim_variant` — the per-platform claim. Two containers holding the
   same (stale) post snapshot: only one publishes each platform.
3. `services.idempotency` — the durable key. Survives a row claim being
   re-armed, and catches the same work arriving through two doors.

Everything external is stubbed: an in-memory repo, an in-memory
idempotency store, a recording publisher. No DB, no Ayrshare.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from marketer.scheduling import dispatch
from marketer.scheduling.schemas import PlatformVariant, ScheduledPost
from marketer.services.scheduler import AyrshareError

USER = "user_sched"
NOW = datetime(2026, 3, 9, 13, 0, tzinfo=timezone.utc)


# --------------------------------------------------------------- fakes


class FakeRepo:
    """In-memory stand-in for repos.scheduled_posts.

    Mirrors the two properties dispatch depends on: reads hand out
    *snapshots* (so a caller can hold a stale view, exactly like a second
    container would), and the claims are conditional on the stored status.
    """

    def __init__(self) -> None:
        self.posts: dict[UUID, ScheduledPost] = {}
        self.finalize_calls: list[UUID] = []

    # -- seeding -------------------------------------------------------
    def seed(self, *, platforms: list[str], at: datetime | None = None,
             status: str = "scheduled", user_id: str = USER) -> ScheduledPost:
        post = ScheduledPost(
            id=uuid4(),
            user_id=user_id,
            content="hello world",
            media_urls=["https://cdn.example.com/a.png"],
            scheduled_at=at or (NOW - timedelta(minutes=1)),
            status=status,
            variants=[PlatformVariant(id=uuid4(), platform=p) for p in platforms],
        )
        self.posts[post.id] = post
        return self._snap(post)

    def stored(self, post_id: UUID) -> ScheduledPost:
        return self.posts[post_id]

    def variant(self, post_id: UUID, platform: str) -> PlatformVariant:
        return next(v for v in self.posts[post_id].variants if v.platform == platform)

    @staticmethod
    def _snap(post: ScheduledPost) -> ScheduledPost:
        return post.model_copy(deep=True)

    def _find_variant(self, variant_id: UUID) -> PlatformVariant | None:
        for post in self.posts.values():
            for v in post.variants:
                if v.id == variant_id:
                    return v
        return None

    # -- the API dispatch uses -----------------------------------------
    async def claim_due(self, *, now: datetime, limit: int = 50) -> list[ScheduledPost]:
        out: list[ScheduledPost] = []
        for post in sorted(self.posts.values(), key=lambda p: p.scheduled_at):
            if len(out) >= limit:
                break
            if post.status == "scheduled" and post.scheduled_at <= now:
                post.status = "dispatching"  # the atomic transition
                out.append(self._snap(post))
        return out

    async def claim_for_publish_now(self, post_id: UUID, *, user_id: str):
        post = self.posts.get(post_id)
        if post is None or post.user_id != user_id or post.status != "scheduled":
            return None
        post.status = "dispatching"
        return self._snap(post)

    async def claim_variant(self, variant_id: UUID) -> bool:
        v = self._find_variant(variant_id)
        if v is None or v.status != "pending":
            return False
        v.status = "dispatching"
        return True

    async def mark_variant_posted(self, variant_id: UUID, *, provider_post_id: str) -> None:
        v = self._find_variant(variant_id)
        assert v is not None
        v.status, v.provider_post_id, v.error = "posted", provider_post_id, None
        v.dispatched_at = NOW

    async def mark_variant_failed(self, variant_id: UUID, *, error: str) -> None:
        v = self._find_variant(variant_id)
        assert v is not None
        v.status, v.error = "failed", error

    async def finalize(self, post_id: UUID):
        self.finalize_calls.append(post_id)
        post = self.posts.get(post_id)
        if post is None:
            return None
        statuses = [v.status for v in post.variants]
        if any(s in ("pending", "dispatching") for s in statuses):
            post.status = "dispatching"
        elif "failed" not in statuses:
            post.status = "posted"
        elif "posted" not in statuses:
            post.status = "failed"
        else:
            post.status = "partial"
        return self._snap(post)

    async def get(self, post_id: UUID, *, user_id: str):
        post = self.posts.get(post_id)
        return self._snap(post) if post and post.user_id == user_id else None


class FakeIdempotency:
    """The durable key store: first claimant wins, forever (within TTL)."""

    def __init__(self) -> None:
        self.claimed: set[str] = set()
        self.done: list[str] = []

    async def claim_spawn(self, key: str, *, ttl_seconds: int | None = None) -> bool:
        if key in self.claimed:
            return False
        self.claimed.add(key)
        return True

    async def mark_done(self, key: str, *, result: dict | None = None) -> None:
        self.done.append(key)


@pytest.fixture
def env(monkeypatch):
    repo = FakeRepo()
    idem = FakeIdempotency()
    published: list[dict] = []
    fail_on: set[str] = set()

    monkeypatch.setattr(dispatch, "repo", repo)
    monkeypatch.setattr(dispatch, "idempotency", idem)

    async def fake_user(user_id: str):
        return SimpleNamespace(ayrshare_profile_key=f"pk-{user_id}")

    monkeypatch.setattr(dispatch.users_repo, "get", fake_user)

    async def fake_publish(*, profile_key, platform, content, media_urls):
        if platform in fail_on:
            raise AyrshareError(f"{platform} said no")
        published.append(
            {"profile_key": profile_key, "platform": platform,
             "content": content, "media_urls": list(media_urls)}
        )
        return f"prov-{len(published)}"

    monkeypatch.setattr(dispatch, "publish_variant", fake_publish)

    return SimpleNamespace(
        repo=repo, idem=idem, published=published, fail_on=fail_on
    )


def _platforms(published: list[dict]) -> list[str]:
    return [p["platform"] for p in published]


# ------------------------------------------------------- happy path


@pytest.mark.asyncio
async def test_due_post_fans_out_to_every_platform(env):
    post = env.repo.seed(platforms=["tiktok", "instagram"])
    result = await dispatch.run_due_dispatch(now=NOW)

    assert result["claimed"] == 1
    assert result["results"][0]["posted"] == 2
    assert sorted(_platforms(env.published)) == ["instagram", "tiktok"]
    assert env.repo.stored(post.id).status == "posted"
    assert all(v.provider_post_id for v in env.repo.stored(post.id).variants)


@pytest.mark.asyncio
async def test_variant_overrides_win_over_the_parent_copy(env):
    post = env.repo.seed(platforms=["tiktok", "linkedin"])
    stored = env.repo.stored(post.id)
    linkedin = next(v for v in stored.variants if v.platform == "linkedin")
    linkedin.content = "a whole paragraph, because LinkedIn"
    linkedin.media_urls = []

    await dispatch.run_due_dispatch(now=NOW)

    by_platform = {p["platform"]: p for p in env.published}
    assert by_platform["linkedin"]["content"] == "a whole paragraph, because LinkedIn"
    assert by_platform["linkedin"]["media_urls"] == []
    # The other platform still inherits the parent's copy and media.
    assert by_platform["tiktok"]["content"] == "hello world"
    assert by_platform["tiktok"]["media_urls"] == ["https://cdn.example.com/a.png"]


@pytest.mark.asyncio
async def test_posts_not_yet_due_are_left_alone(env):
    post = env.repo.seed(platforms=["tiktok"], at=NOW + timedelta(hours=1))
    assert (await dispatch.run_due_dispatch(now=NOW))["claimed"] == 0
    assert env.published == []
    assert env.repo.stored(post.id).status == "scheduled"


@pytest.mark.asyncio
async def test_cron_skips_due_posts_when_publish_flag_off(env, monkeypatch):
    """Admin publish kill-switch must not claim due rows — they stay
    scheduled so they go out once the flag is re-enabled."""
    from marketer.repos import feature_flags as flags_repo

    async def _denied(key: str) -> bool:
        assert key == "publish"
        return False

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    post = env.repo.seed(platforms=["tiktok"])
    result = await dispatch.run_due_dispatch(now=NOW)

    assert result["claimed"] == 0
    assert result["reason"] == "feature 'publish' is disabled"
    assert env.published == []
    assert env.repo.stored(post.id).status == "scheduled"


# ------------------------------------------- GUARD 1: the per-post claim


@pytest.mark.asyncio
async def test_running_the_loop_twice_does_not_double_post(env):
    """THE test. A cron that fires twice (overlapping tick, platform-level
    retry of the invocation) must publish exactly once."""
    post = env.repo.seed(platforms=["tiktok", "instagram"])

    first = await dispatch.run_due_dispatch(now=NOW)
    second = await dispatch.run_due_dispatch(now=NOW)

    assert first["claimed"] == 1
    assert second["claimed"] == 0, "second pass re-claimed an already-dispatched post"
    assert sorted(_platforms(env.published)) == ["instagram", "tiktok"]
    assert len(env.published) == 2, f"double post: {_platforms(env.published)}"
    assert env.repo.stored(post.id).status == "posted"


@pytest.mark.asyncio
async def test_two_concurrent_dispatchers_split_the_work_and_never_overlap(env):
    """Two containers on the same tick. Every post goes out exactly once,
    regardless of which container won it."""
    posts = [env.repo.seed(platforms=["tiktok"]) for _ in range(5)]

    left, right = await asyncio.gather(
        dispatch.run_due_dispatch(now=NOW), dispatch.run_due_dispatch(now=NOW)
    )

    assert left["claimed"] + right["claimed"] == 5
    assert len(env.published) == 5
    assert all(env.repo.stored(p.id).status == "posted" for p in posts)


# ---------------------------------------- GUARD 2: the per-variant claim


@pytest.mark.asyncio
async def test_a_stale_snapshot_cannot_republish_a_claimed_variant(env):
    """Both containers already hold the post object (they raced past the
    per-post claim in some future refactor, or publish-now overlapped the
    cron). The per-platform claim is the only thing left, and it holds."""
    snapshot = env.repo.seed(platforms=["tiktok", "instagram"])

    first = await dispatch.dispatch_post(snapshot)
    second = await dispatch.dispatch_post(snapshot)  # same stale snapshot

    assert first["posted"] == 2
    assert second["posted"] == 0
    assert second["skipped"] == 2
    assert len(env.published) == 2, f"double post: {_platforms(env.published)}"


@pytest.mark.asyncio
async def test_retry_resends_only_the_platform_that_failed(env):
    """A partially-failed post is legitimately dispatchable again — and the
    platform that already landed must not go out a second time."""
    env.fail_on.add("instagram")
    post = env.repo.seed(platforms=["tiktok", "instagram"])
    await dispatch.run_due_dispatch(now=NOW)

    assert env.repo.stored(post.id).status == "partial"
    assert _platforms(env.published) == ["tiktok"]

    # The user reschedules: the repo re-arms only the FAILED variant and
    # the move rewrites scheduled_at, which mints a fresh idempotency key.
    stored = env.repo.stored(post.id)
    stored.status = "scheduled"
    stored.scheduled_at = NOW + timedelta(hours=1)
    env.repo.variant(post.id, "instagram").status = "pending"
    env.fail_on.clear()

    await dispatch.run_due_dispatch(now=NOW + timedelta(hours=2))

    assert _platforms(env.published) == ["tiktok", "instagram"]
    assert env.repo.stored(post.id).status == "posted"


# ------------------------------------------ GUARD 3: the durable key


@pytest.mark.asyncio
async def test_idempotency_key_blocks_a_republish_at_the_same_instant(env):
    """Belt and braces: even if a variant is wrongly re-armed to `pending`
    WITHOUT the post being moved, the durable key refuses the second
    publish and parks the variant as failed with an explicit reason.

    Releasing the row claim back to `pending` here would re-open the
    double-post window, which is why it is parked rather than retried.
    """
    post = env.repo.seed(platforms=["tiktok"])
    await dispatch.run_due_dispatch(now=NOW)
    assert len(env.published) == 1

    # Same scheduled_at => same key. Simulate a bad re-arm.
    env.repo.variant(post.id, "tiktok").status = "pending"
    env.repo.stored(post.id).status = "scheduled"

    await dispatch.run_due_dispatch(now=NOW)

    assert len(env.published) == 1, "durable idempotency guard did not hold"
    variant = env.repo.variant(post.id, "tiktok")
    assert variant.status == "failed"
    assert "duplicate dispatch suppressed" in (variant.error or "")


def test_variant_key_changes_only_when_the_post_moves():
    post = ScheduledPost(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        user_id=USER, scheduled_at=NOW, content="x",
    )
    moved = post.model_copy(update={"scheduled_at": NOW + timedelta(minutes=1)})

    assert dispatch.variant_key(post, "tiktok") == dispatch.variant_key(post, "tiktok")
    # Different destination and different time are both distinct units of work.
    assert dispatch.variant_key(post, "tiktok") != dispatch.variant_key(post, "instagram")
    assert dispatch.variant_key(post, "tiktok") != dispatch.variant_key(moved, "tiktok")
    # The key is offset-independent: the same instant expressed in another
    # zone must not mint a second key.
    other_zone = post.model_copy(
        update={"scheduled_at": NOW.astimezone(timezone(timedelta(hours=5)))}
    )
    assert dispatch.variant_key(post, "tiktok") == dispatch.variant_key(other_zone, "tiktok")


# ------------------------------------------------------- failure paths


@pytest.mark.asyncio
async def test_provider_failure_is_per_platform(env):
    env.fail_on.add("tiktok")
    post = env.repo.seed(platforms=["tiktok", "instagram"])
    result = await dispatch.run_due_dispatch(now=NOW)

    assert result["results"][0] == {
        "post_id": str(post.id), "status": "partial",
        "posted": 1, "failed": 1, "skipped": 0,
    }
    assert env.repo.variant(post.id, "tiktok").status == "failed"
    assert "tiktok said no" in (env.repo.variant(post.id, "tiktok").error or "")
    assert env.repo.variant(post.id, "instagram").status == "posted"


@pytest.mark.asyncio
async def test_every_platform_failing_lands_the_post_in_failed(env):
    env.fail_on.update({"tiktok", "instagram"})
    post = env.repo.seed(platforms=["tiktok", "instagram"])
    await dispatch.run_due_dispatch(now=NOW)
    assert env.repo.stored(post.id).status == "failed"


@pytest.mark.asyncio
async def test_missing_ayrshare_profile_fails_every_variant_with_one_reason(
    env, monkeypatch
):
    async def no_profile(user_id: str):
        return SimpleNamespace(ayrshare_profile_key=None)

    monkeypatch.setattr(dispatch.users_repo, "get", no_profile)
    post = env.repo.seed(platforms=["tiktok", "instagram"])
    result = await dispatch.run_due_dispatch(now=NOW)

    assert result["results"][0]["failed"] == 2
    assert env.published == []
    assert env.repo.stored(post.id).status == "failed"
    for platform in ("tiktok", "instagram"):
        assert "ayrshare_profile_key" in (env.repo.variant(post.id, platform).error or "")


@pytest.mark.asyncio
async def test_one_exploding_post_does_not_stop_the_batch(env, monkeypatch):
    good = env.repo.seed(platforms=["tiktok"], at=NOW - timedelta(minutes=1))
    bad = env.repo.seed(platforms=["instagram"], at=NOW - timedelta(minutes=2))

    original = dispatch.dispatch_post

    async def flaky(post):
        if post.id == bad.id:
            raise RuntimeError("boom")
        return await original(post)

    monkeypatch.setattr(dispatch, "dispatch_post", flaky)
    result = await dispatch.run_due_dispatch(now=NOW)

    assert result["claimed"] == 2
    assert _platforms(env.published) == ["tiktok"]
    assert env.repo.stored(good.id).status == "posted"
    # The crashed post is still finalized so it cannot sit in `dispatching`.
    assert bad.id in env.repo.finalize_calls


@pytest.mark.asyncio
async def test_limit_bounds_one_pass(env):
    for _ in range(4):
        env.repo.seed(platforms=["tiktok"])
    assert (await dispatch.run_due_dispatch(now=NOW, limit=2))["claimed"] == 2


# ------------------------------------------------------- publish-now path


@pytest.mark.asyncio
async def test_dispatch_claimed_post_publishes_the_claimed_row(env):
    post = env.repo.seed(platforms=["tiktok"])
    await env.repo.claim_for_publish_now(post.id, user_id=USER)

    result = await dispatch.dispatch_claimed_post(user_id=USER, post_id=post.id)

    assert result["posted"] == 1
    assert env.repo.stored(post.id).status == "posted"


@pytest.mark.asyncio
async def test_dispatch_claimed_post_is_a_noop_for_another_user(env):
    post = env.repo.seed(platforms=["tiktok"], user_id="someone_else")
    result = await dispatch.dispatch_claimed_post(user_id=USER, post_id=post.id)
    assert result["error"] == "not found"
    assert env.published == []


@pytest.mark.asyncio
async def test_publish_now_and_the_cron_cannot_both_send(env):
    """The two doors into dispatch, racing on the same post."""
    post = env.repo.seed(platforms=["tiktok"])
    claimed = await env.repo.claim_for_publish_now(post.id, user_id=USER)
    assert claimed is not None

    cron = await dispatch.run_due_dispatch(now=NOW)
    await dispatch.dispatch_claimed_post(user_id=USER, post_id=post.id)

    assert cron["claimed"] == 0  # the button already owned it
    assert len(env.published) == 1


# -------------------------------------------------- the Ayrshare call itself


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    calls: list[dict] = []
    response = _FakeResponse(200, {"status": "success", "id": "ayr-1"})

    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def post(self, url, *, headers, json):
        type(self).calls.append({"url": url, "headers": headers, "json": json})
        return type(self).response


@pytest.fixture
def fake_http(monkeypatch):
    from marketer.config import settings

    # scheduler._headers() fails closed without a key; this suite is about
    # the request we build, not about the config gate.
    monkeypatch.setattr(settings, "ayrshare_api_key", "ayr-test-key")
    _FakeClient.calls = []
    _FakeClient.response = _FakeResponse(200, {"status": "success", "id": "ayr-1"})
    monkeypatch.setattr(dispatch.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


@pytest.mark.asyncio
async def test_publish_variant_refuses_when_publish_flag_off(fake_http, monkeypatch):
    from marketer.repos import feature_flags as flags_repo

    async def _denied(key: str) -> bool:
        assert key == "publish"
        return False

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    with pytest.raises(AyrshareError, match="publish"):
        await dispatch.publish_variant(
            profile_key="pk", platform="tiktok", content="hi", media_urls=[]
        )
    assert fake_http.calls == []


@pytest.mark.asyncio
async def test_publish_variant_posts_one_platform_and_never_schedules(fake_http):
    """No `scheduleDate` in the body: we are the scheduler. Handing
    Ayrshare a future date would put the post in two queues with no way to
    cancel ours without orphaning theirs."""
    post_id = await dispatch.publish_variant(
        profile_key="pk", platform="tiktok", content="hi",
        media_urls=["https://cdn.example.com/a.png"],
    )
    assert post_id == "ayr-1"
    body = fake_http.calls[0]["json"]
    assert body == {
        "post": "hi", "platforms": ["tiktok"],
        "mediaUrls": ["https://cdn.example.com/a.png"],
    }
    assert "scheduleDate" not in body


@pytest.mark.asyncio
async def test_publish_variant_omits_media_when_there_is_none(fake_http):
    await dispatch.publish_variant(
        profile_key="pk", platform="tiktok", content="hi", media_urls=[]
    )
    assert "mediaUrls" not in fake_http.calls[0]["json"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        _FakeResponse(500, {"message": "nope"}),
        _FakeResponse(200, {"status": "error"}),
        _FakeResponse(200, {"status": "success"}),  # no id
    ],
)
async def test_publish_variant_raises_on_a_bad_response(fake_http, response):
    fake_http.response = response
    with pytest.raises(AyrshareError):
        await dispatch.publish_variant(
            profile_key="pk", platform="tiktok", content="hi", media_urls=[]
        )
