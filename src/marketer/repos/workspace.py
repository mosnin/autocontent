"""Cross-department aggregates for the workspace (Home / Inbox / Activity).

Read-only joins over the per-department tables (jobs, image_posts, articles,
spend_ledger, post_metrics, ad_*, campaigns). Every query is user-scoped.
Rows come back as plain dicts with raw values (Decimal money, aware
datetimes); the route layer shapes them into the response contract.

Time handling: windows are half-open ``[start, end)`` on aware UTC
datetimes; day buckets are UTC calendar days, matching ``spend.history``.
"Reached done at" for jobs / image posts / articles is approximated by the
row's ``updated_at`` (no dedicated completed_at column exists; status is
terminal at that point, so later writes are rare).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from ..db import get_pool

# Non-terminal statuses = "in flight". awaiting_approval counts as active:
# the work exists and is waiting on the user.
_JOB_ACTIVE = (
    "queued", "ideating", "scripting", "generating_images", "animating",
    "voicing", "editing", "captioning", "qa", "scheduling", "awaiting_approval",
)
_IMAGE_POST_ACTIVE = (
    "queued", "planning", "generating", "awaiting_approval", "scheduling",
)
_ARTICLE_ACTIVE = (
    "queued", "researching", "outlining", "writing", "qa", "metadata", "imaging",
)

# Human titles fall back to these when the pipeline hasn't produced one yet.
_JOB_TITLE_SQL = (
    "coalesce(nullif(j.payload->'script'->'idea'->>'topic', ''), "
    "'Video for ' || n.title)"
)
_IMAGE_TITLE_SQL = (
    "coalesce(nullif(ip.topic, ''), nullif(split_part(ip.payload->>'caption', "
    "E'\\n', 1), ''), initcap(ip.kind) || ' for ' || n.title)"
)
_ARTICLE_TITLE_SQL = (
    "coalesce(nullif(a.title, ''), nullif(a.topic, ''), 'Article for ' || n.title)"
)


def _dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal("0")


# --------------------------------------------------------------------------- overview


async def window_kpis(user_id: str, *, start: datetime, end: datetime) -> dict:
    """Headline numbers for one window ``[start, end)``.

    - content_spend_usd: spend_ledger (every metered content-pipeline call).
    - ad_spend_usd / ad_clicks / ad_conversions: ad_metrics_daily, by its
      ``date`` column (day granularity), for days in the window.
    - posts_published: videos + image posts that reached ``done``.
    - views / engagements: the latest post_metrics sample per post sampled in
      the window (engagements = likes + comments + shares + saves). Only video
      jobs are sampled today (post_metrics.job_id is NOT NULL).
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        with latest as (
            select distinct on (pm.job_id)
                   pm.job_id, pm.views, pm.likes, pm.comments, pm.shares, pm.saves
              from post_metrics pm
             where pm.user_id = $1 and pm.sampled_at >= $2 and pm.sampled_at < $3
             order by pm.job_id, pm.sampled_at desc
        )
        select
          (select coalesce(sum(cost_usd), 0) from spend_ledger
            where user_id = $1 and created_at >= $2 and created_at < $3)
            as content_spend_usd,
          (select coalesce(sum(spend_usd), 0) from ad_metrics_daily
            where user_id = $1 and date >= $4 and date < $5) as ad_spend_usd,
          (select coalesce(sum(clicks), 0) from ad_metrics_daily
            where user_id = $1 and date >= $4 and date < $5) as ad_clicks,
          (select coalesce(sum(conversions), 0) from ad_metrics_daily
            where user_id = $1 and date >= $4 and date < $5) as ad_conversions,
          (select count(*) from jobs
            where user_id = $1 and status = 'done'
              and updated_at >= $2 and updated_at < $3)
          + (select count(*) from image_posts
            where user_id = $1 and status = 'done'
              and updated_at >= $2 and updated_at < $3) as posts_published,
          (select count(*) from articles
            where user_id = $1 and status = 'done'
              and updated_at >= $2 and updated_at < $3) as articles_published,
          (select coalesce(sum(views), 0) from latest) as views,
          (select coalesce(sum(coalesce(likes, 0) + coalesce(comments, 0)
                               + coalesce(shares, 0) + coalesce(saves, 0)), 0)
             from latest) as engagements
        """,
        user_id, start, end, start.date(), end.date(),
    )
    return {
        "content_spend_usd": _dec(row["content_spend_usd"]),
        "ad_spend_usd": _dec(row["ad_spend_usd"]),
        "ad_clicks": int(row["ad_clicks"] or 0),
        "ad_conversions": _dec(row["ad_conversions"]),
        "posts_published": int(row["posts_published"] or 0),
        "articles_published": int(row["articles_published"] or 0),
        "views": int(row["views"] or 0),
        "engagements": int(row["engagements"] or 0),
    }


async def daily_series(user_id: str, *, start: datetime, end: datetime) -> dict[date, dict]:
    """Per-UTC-day buckets for ``[start, end)``; only days with data appear
    (the caller zero-fills).

    ``views`` per day is views *gained* that day: for each post, the last
    sample of the day minus the last sample of the previous sampled day
    (first sample counts in full; clamped at 0 for platform corrections).
    That keeps a daily chart meaningful instead of re-counting cumulative
    totals every day.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        with content as (
            select (created_at at time zone 'utc')::date as day,
                   sum(cost_usd) as content_spend_usd
              from spend_ledger
             where user_id = $1 and created_at >= $2 and created_at < $3
             group by 1
        ),
        ads as (
            select date as day, sum(spend_usd) as ad_spend_usd
              from ad_metrics_daily
             where user_id = $1 and date >= $4 and date < $5
             group by 1
        ),
        posts as (
            select day, count(*) as posts from (
                select (updated_at at time zone 'utc')::date as day from jobs
                 where user_id = $1 and status = 'done'
                   and updated_at >= $2 and updated_at < $3
                union all
                select (updated_at at time zone 'utc')::date as day from image_posts
                 where user_id = $1 and status = 'done'
                   and updated_at >= $2 and updated_at < $3
            ) p group by day
        ),
        daily_last as (
            select distinct on (job_id, d)
                   job_id, (sampled_at at time zone 'utc')::date as d,
                   coalesce(views, 0) as v
              from post_metrics
             where user_id = $1 and sampled_at < $3
             order by job_id, d, sampled_at desc
        ),
        gained as (
            select d as day,
                   greatest(v - coalesce(lag(v) over (partition by job_id order by d), 0), 0)
                     as views
              from daily_last
        ),
        views as (
            select day, sum(views) as views from gained
             where day >= $4 group by day
        )
        select coalesce(c.day, a.day, p.day, v.day) as day,
               coalesce(c.content_spend_usd, 0) as content_spend_usd,
               coalesce(a.ad_spend_usd, 0) as ad_spend_usd,
               coalesce(v.views, 0) as views,
               coalesce(p.posts, 0) as posts
          from content c
          full outer join ads a on a.day = c.day
          full outer join posts p on p.day = coalesce(c.day, a.day)
          full outer join views v on v.day = coalesce(c.day, a.day, p.day)
        """,
        user_id, start, end, start.date(), end.date(),
    )
    out: dict[date, dict] = {}
    for r in rows:
        out[r["day"]] = {
            "content_spend_usd": _dec(r["content_spend_usd"]),
            "ad_spend_usd": _dec(r["ad_spend_usd"]),
            "views": int(r["views"] or 0),
            "posts": int(r["posts"] or 0),
        }
    return out


async def pipeline_counts(user_id: str, *, start: datetime, end: datetime) -> dict:
    """Active (in flight right now) plus done/failed within the window, per
    department; ads: active campaigns and pending approvals right now."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select
          (select count(*) from jobs where user_id = $1
             and status::text = any($4::text[]))
          + (select count(*) from image_posts where user_id = $1
             and status = any($5::text[])) as content_active,
          (select count(*) from jobs where user_id = $1 and status = 'done'
             and updated_at >= $2 and updated_at < $3)
          + (select count(*) from image_posts where user_id = $1 and status = 'done'
             and updated_at >= $2 and updated_at < $3) as content_done,
          (select count(*) from jobs where user_id = $1 and status = 'failed'
             and updated_at >= $2 and updated_at < $3)
          + (select count(*) from image_posts where user_id = $1 and status = 'failed'
             and updated_at >= $2 and updated_at < $3) as content_failed,
          (select count(*) from articles where user_id = $1
             and status::text = any($6::text[])) as seo_active,
          (select count(*) from articles where user_id = $1 and status = 'done'
             and updated_at >= $2 and updated_at < $3) as seo_done,
          (select count(*) from articles where user_id = $1 and status = 'failed'
             and updated_at >= $2 and updated_at < $3) as seo_failed,
          (select count(*) from ad_campaigns where user_id = $1
             and status = 'active') as ads_active_campaigns,
          (select count(*) from ad_approvals where user_id = $1
             and status = 'pending') as ads_pending_approvals
        """,
        user_id, start, end,
        list(_JOB_ACTIVE), list(_IMAGE_POST_ACTIVE), list(_ARTICLE_ACTIVE),
    )
    return {
        "content": {
            "active": int(row["content_active"]),
            "done": int(row["content_done"]),
            "failed": int(row["content_failed"]),
        },
        "seo": {
            "active": int(row["seo_active"]),
            "done": int(row["seo_done"]),
            "failed": int(row["seo_failed"]),
        },
        "ads": {
            "active_campaigns": int(row["ads_active_campaigns"]),
            "pending_approvals": int(row["ads_pending_approvals"]),
        },
    }


async def top_content(
    user_id: str, *, start: datetime, end: datetime, limit: int = 8
) -> list[dict]:
    """Published content in the window, best first: views desc (videos carry
    their latest post_metrics sample; articles/carousels have no views yet,
    so they sort after sampled videos), then most recent."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        with latest as (
            select distinct on (pm.job_id) pm.job_id, pm.views
              from post_metrics pm
             where pm.user_id = $1
             order by pm.job_id, pm.sampled_at desc
        )
        select * from (
            select 'video' as kind, j.id::text as id, {_JOB_TITLE_SQL} as title,
                   j.platform as platform, l.views as views,
                   j.created_at as created_at, j.updated_at as done_at
              from jobs j
              join niches n on n.id = j.niche_id
              left join latest l on l.job_id = j.id
             where j.user_id = $1 and j.status = 'done'
               and j.updated_at >= $2 and j.updated_at < $3
            union all
            select 'carousel', ip.id::text, {_IMAGE_TITLE_SQL},
                   nullif(ip.payload->>'platform', ''), null::bigint,
                   ip.created_at, ip.updated_at
              from image_posts ip
              join niches n on n.id = ip.niche_id
             where ip.user_id = $1 and ip.status = 'done'
               and ip.updated_at >= $2 and ip.updated_at < $3
            union all
            select 'article', a.id::text, {_ARTICLE_TITLE_SQL},
                   null::text, null::bigint, a.created_at, a.updated_at
              from articles a
              join niches n on n.id = a.niche_id
             where a.user_id = $1 and a.status = 'done'
               and a.updated_at >= $2 and a.updated_at < $3
        ) t
        order by views desc nulls last, done_at desc
        limit $4
        """,
        user_id, start, end, limit,
    )
    return [
        {
            "kind": r["kind"],
            "id": r["id"],
            "title": r["title"],
            "platform": r["platform"],
            "views": int(r["views"]) if r["views"] is not None else None,
            "created_at": r["created_at"],
        }
        for r in rows
    ]


# --------------------------------------------------------------------------- inbox


async def inbox_items(user_id: str, *, limit: int = 200) -> list[dict]:
    """Everything waiting on the user: videos and image posts parked at
    awaiting_approval, plus pending ad spend approvals. Raw rows; the route
    builds the one-line detail. Newest first across sources."""
    pool = await get_pool()
    videos = await pool.fetch(
        f"""
        select j.id, j.platform, j.niche_id, n.title as niche_title,
               {_JOB_TITLE_SQL} as title, j.created_at
          from jobs j join niches n on n.id = j.niche_id
         where j.user_id = $1 and j.status = 'awaiting_approval'
         order by j.created_at desc limit $2
        """,
        user_id, limit,
    )
    images = await pool.fetch(
        f"""
        select ip.id, ip.kind, nullif(ip.payload->>'platform', '') as platform,
               ip.niche_id, n.title as niche_title,
               {_IMAGE_TITLE_SQL} as title, ip.created_at
          from image_posts ip join niches n on n.id = ip.niche_id
         where ip.user_id = $1 and ip.status = 'awaiting_approval'
         order by ip.created_at desc limit $2
        """,
        user_id, limit,
    )
    approvals = await pool.fetch(
        """
        select ap.id, ap.action, ap.summary, ap.dollar_delta_usd,
               ap.payload_json as payload, ap.created_at,
               c.name as campaign_name, c.daily_budget_usd as campaign_daily_budget_usd,
               c.niche_id
          from ad_approvals ap
          left join ad_campaigns c on c.id = ap.campaign_id and c.user_id = ap.user_id
         where ap.user_id = $1 and ap.status = 'pending'
         order by ap.created_at desc limit $2
        """,
        user_id, limit,
    )
    out: list[dict] = []
    for r in videos:
        out.append({"source": "video", **dict(r)})
    for r in images:
        out.append({"source": "carousel", **dict(r)})
    for r in approvals:
        d = dict(r)
        if isinstance(d.get("payload"), str):
            import json

            d["payload"] = json.loads(d["payload"])
        out.append({"source": "ad_change", **d})
    out.sort(key=lambda d: d["created_at"], reverse=True)
    return out


# --------------------------------------------------------------------------- activity


async def activity_events(
    user_id: str, *, before: datetime | None, limit: int
) -> list[dict]:
    """Recent state changes across departments, newest first.

    Each source contributes at most ``limit`` rows older than ``before``;
    the merged list is cut to ``limit``. Jobs / articles / image posts /
    campaigns surface their current status at ``updated_at``; ad actions are
    the append-only audit log at ``created_at``; ad approvals appear once
    decided, at ``decided_at``.
    """
    pool = await get_pool()
    args = (user_id, before, limit)
    jobs = await pool.fetch(
        f"""
        select j.id, j.status::text as status, j.platform, j.error,
               n.title as niche_title, {_JOB_TITLE_SQL} as title, j.updated_at as at
          from jobs j join niches n on n.id = j.niche_id
         where j.user_id = $1 and ($2::timestamptz is null or j.updated_at < $2)
         order by j.updated_at desc limit $3
        """,
        *args,
    )
    articles = await pool.fetch(
        f"""
        select a.id, a.status::text as status, a.error,
               n.title as niche_title, {_ARTICLE_TITLE_SQL} as title, a.updated_at as at
          from articles a join niches n on n.id = a.niche_id
         where a.user_id = $1 and ($2::timestamptz is null or a.updated_at < $2)
         order by a.updated_at desc limit $3
        """,
        *args,
    )
    images = await pool.fetch(
        f"""
        select ip.id, ip.status, ip.error, nullif(ip.payload->>'platform', '') as platform,
               n.title as niche_title, {_IMAGE_TITLE_SQL} as title, ip.updated_at as at
          from image_posts ip join niches n on n.id = ip.niche_id
         where ip.user_id = $1 and ($2::timestamptz is null or ip.updated_at < $2)
         order by ip.updated_at desc limit $3
        """,
        *args,
    )
    actions = await pool.fetch(
        """
        select id, actor, action, platform, target_type, target_id,
               dollar_delta_usd, created_at as at
          from ad_actions_log
         where user_id = $1 and ($2::timestamptz is null or created_at < $2)
         order by created_at desc limit $3
        """,
        *args,
    )
    approvals = await pool.fetch(
        """
        select id, action, summary, status, decided_by, dollar_delta_usd,
               decided_at as at
          from ad_approvals
         where user_id = $1 and decided_at is not null
           and ($2::timestamptz is null or decided_at < $2)
         order by decided_at desc limit $3
        """,
        *args,
    )
    campaigns = await pool.fetch(
        """
        select id, name, objective, status, budget_usd, updated_at as at
          from campaigns
         where user_id = $1 and ($2::timestamptz is null or updated_at < $2)
         order by updated_at desc limit $3
        """,
        *args,
    )
    out: list[dict] = []
    for source, rows in (
        ("video", jobs), ("article", articles), ("carousel", images),
        ("ad_action", actions), ("approval", approvals), ("campaign", campaigns),
    ):
        out.extend({"source": source, **dict(r)} for r in rows)
    out.sort(key=lambda d: d["at"], reverse=True)
    return out[:limit]
