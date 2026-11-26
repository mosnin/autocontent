"""Tracker templates: the tables a marketing team reaches for first.

Each template is data: fields (the first is the primary field), views and a
few starter rows. ``prefill`` names a function in the service that adds rows
linked to the workspace's own Marketer objects (its campaigns, its recent
videos and articles), so a new tracker starts with the team's real work.
Field and option names here are what the agent writes to (it may address
fields and options by name), so rename them with care.
"""
from __future__ import annotations

from typing import Any

TEMPLATES: dict[str, dict[str, Any]] = {
    "content_calendar": {
        "name": "Content calendar",
        "description": "Every piece from idea to published, on a calendar.",
        "fields": [
            {"name": "Title", "type": "text"},
            {"name": "Status", "type": "single_select", "options": {"choices": [
                {"label": "Idea", "color": "gray"},
                {"label": "Drafting", "color": "blue"},
                {"label": "In review", "color": "orange"},
                {"label": "Scheduled", "color": "purple"},
                {"label": "Published", "color": "green"},
            ]}},
            {"name": "Channel", "type": "multi_select", "options": {"choices": [
                {"label": "TikTok", "color": "pink"},
                {"label": "Instagram", "color": "purple"},
                {"label": "YouTube", "color": "red"},
                {"label": "LinkedIn", "color": "blue"},
                {"label": "Blog", "color": "teal"},
                {"label": "Newsletter", "color": "yellow"},
            ]}},
            {"name": "Publish date", "type": "date"},
            {"name": "Owner", "type": "person"},
            {"name": "Video", "type": "marketer_link", "options": {"kind": "video"}},
            {"name": "Article", "type": "marketer_link", "options": {"kind": "article"}},
            {"name": "Notes", "type": "long_text"},
        ],
        "views": [
            {"name": "Calendar", "type": "calendar", "config": {"date_field": "Publish date"}},
            {"name": "By status", "type": "board", "config": {"group_field": "Status"}},
            {"name": "All content", "type": "grid"},
        ],
        "rows": [],
        "prefill": "content",
    },
    "social_posts": {
        "name": "Social post tracker",
        "description": "Posts by platform and status, with captions and links.",
        "fields": [
            {"name": "Post", "type": "text"},
            {"name": "Platform", "type": "single_select", "options": {"choices": [
                {"label": "TikTok", "color": "pink"},
                {"label": "Instagram", "color": "purple"},
                {"label": "YouTube Shorts", "color": "red"},
                {"label": "LinkedIn", "color": "blue"},
                {"label": "X", "color": "gray"},
                {"label": "Facebook", "color": "teal"},
            ]}},
            {"name": "Status", "type": "single_select", "options": {"choices": [
                {"label": "Draft", "color": "gray"},
                {"label": "Scheduled", "color": "purple"},
                {"label": "Posted", "color": "green"},
                {"label": "Needs a fix", "color": "red"},
            ]}},
            {"name": "Post date", "type": "date", "options": {"include_time": True}},
            {"name": "Caption", "type": "long_text"},
            {"name": "Link", "type": "url"},
            {"name": "Carousel", "type": "marketer_link", "options": {"kind": "carousel"}},
            {"name": "Video", "type": "marketer_link", "options": {"kind": "video"}},
            {"name": "Owner", "type": "person"},
        ],
        "views": [
            {"name": "By status", "type": "board", "config": {"group_field": "Status"}},
            {"name": "Calendar", "type": "calendar", "config": {"date_field": "Post date"}},
            {"name": "All posts", "type": "grid"},
        ],
        "rows": [],
        "prefill": "posts",
    },
    "ab_tests": {
        "name": "A/B test log",
        "description": "Hypothesis, variants, the metric, the result and what you decided.",
        "fields": [
            {"name": "Test", "type": "text"},
            {"name": "Hypothesis", "type": "long_text"},
            {"name": "Variant A", "type": "text"},
            {"name": "Variant B", "type": "text"},
            {"name": "Metric", "type": "single_select", "options": {"choices": [
                {"label": "Click-through rate", "color": "blue"},
                {"label": "Conversion rate", "color": "green"},
                {"label": "Watch time", "color": "purple"},
                {"label": "Engagement rate", "color": "pink"},
                {"label": "Cost per acquisition", "color": "orange"},
                {"label": "Open rate", "color": "teal"},
            ]}},
            {"name": "Status", "type": "single_select", "options": {"choices": [
                {"label": "Planned", "color": "gray"},
                {"label": "Running", "color": "blue"},
                {"label": "Concluded", "color": "green"},
            ]}},
            {"name": "Result", "type": "long_text"},
            {"name": "Winner", "type": "single_select", "options": {"choices": [
                {"label": "A", "color": "blue"},
                {"label": "B", "color": "purple"},
                {"label": "No difference", "color": "gray"},
            ]}},
            {"name": "Decision", "type": "single_select", "options": {"choices": [
                {"label": "Ship A", "color": "blue"},
                {"label": "Ship B", "color": "purple"},
                {"label": "Iterate", "color": "orange"},
                {"label": "Drop", "color": "red"},
            ]}},
            {"name": "Start date", "type": "date"},
            {"name": "End date", "type": "date"},
            {"name": "Campaign", "type": "marketer_link", "options": {"kind": "campaign"}},
            {"name": "Owner", "type": "person"},
        ],
        "views": [
            {"name": "All tests", "type": "grid"},
            {"name": "By status", "type": "board", "config": {"group_field": "Status"}},
            {"name": "Running", "type": "grid", "filters": [{"field": "Status", "op": "is", "value": "Running"}]},
        ],
        "rows": [],
        "prefill": None,
    },
    "campaigns": {
        "name": "Campaign tracker",
        "description": "Your campaigns by stage, with goals, budgets and dates.",
        "fields": [
            {"name": "Campaign", "type": "text"},
            {"name": "Marketer campaign", "type": "marketer_link", "options": {"kind": "campaign"}},
            {"name": "Stage", "type": "single_select", "options": {"choices": [
                {"label": "Planning", "color": "gray"},
                {"label": "Live", "color": "green"},
                {"label": "Paused", "color": "orange"},
                {"label": "Wrapped", "color": "blue"},
            ]}},
            {"name": "Goal", "type": "long_text"},
            {"name": "Budget", "type": "number", "options": {"decimals": 2, "prefix": "$"}},
            {"name": "Start", "type": "date"},
            {"name": "End", "type": "date"},
            {"name": "Owner", "type": "person"},
            {"name": "Channels", "type": "multi_select", "options": {"choices": [
                {"label": "Organic social", "color": "pink"},
                {"label": "Paid social", "color": "purple"},
                {"label": "Search", "color": "blue"},
                {"label": "Email", "color": "yellow"},
                {"label": "Blog", "color": "teal"},
            ]}},
        ],
        "views": [
            {"name": "By stage", "type": "board", "config": {"group_field": "Stage"}},
            {"name": "Timeline", "type": "calendar", "config": {"date_field": "Start"}},
            {"name": "All campaigns", "type": "grid"},
        ],
        "rows": [],
        "prefill": "campaigns",
    },
    "launch_checklist": {
        "name": "Launch checklist",
        "description": "Everything that has to happen before, on and after launch day.",
        "fields": [
            {"name": "Task", "type": "text"},
            {"name": "Done", "type": "checkbox"},
            {"name": "Phase", "type": "single_select", "options": {"choices": [
                {"label": "Before launch", "color": "blue"},
                {"label": "Launch day", "color": "green"},
                {"label": "After launch", "color": "purple"},
            ]}},
            {"name": "Due", "type": "date"},
            {"name": "Owner", "type": "person"},
            {"name": "Notes", "type": "long_text"},
        ],
        "views": [
            {"name": "Checklist", "type": "grid", "sorts": [{"field": "Due", "direction": "asc"}]},
            {"name": "By phase", "type": "board", "config": {"group_field": "Phase"}},
            {"name": "Calendar", "type": "calendar", "config": {"date_field": "Due"}},
        ],
        "rows": [
            {"Task": "Write the launch message and one-line pitch", "Phase": "Before launch"},
            {"Task": "Brief the creative: video, carousel and hero image", "Phase": "Before launch"},
            {"Task": "Draft the launch article", "Phase": "Before launch"},
            {"Task": "Schedule social posts for launch day", "Phase": "Before launch"},
            {"Task": "Set ad budgets and audiences", "Phase": "Before launch"},
            {"Task": "Publish the article and go live on social", "Phase": "Launch day"},
            {"Task": "Answer comments for the first six hours", "Phase": "Launch day"},
            {"Task": "Review results and write up what worked", "Phase": "After launch"},
        ],
        "prefill": None,
    },
    "creative_briefs": {
        "name": "Creative brief board",
        "description": "Briefs from request to approved, with audience and key message.",
        "fields": [
            {"name": "Brief", "type": "text"},
            {"name": "Stage", "type": "single_select", "options": {"choices": [
                {"label": "Requested", "color": "gray"},
                {"label": "Briefing", "color": "blue"},
                {"label": "In production", "color": "purple"},
                {"label": "In review", "color": "orange"},
                {"label": "Approved", "color": "green"},
            ]}},
            {"name": "Format", "type": "multi_select", "options": {"choices": [
                {"label": "Video", "color": "pink"},
                {"label": "Carousel", "color": "purple"},
                {"label": "Article", "color": "teal"},
                {"label": "Ad", "color": "orange"},
                {"label": "Email", "color": "yellow"},
            ]}},
            {"name": "Audience", "type": "long_text"},
            {"name": "Key message", "type": "long_text"},
            {"name": "Due", "type": "date"},
            {"name": "Owner", "type": "person"},
            {"name": "Reference", "type": "url"},
            {"name": "Campaign", "type": "marketer_link", "options": {"kind": "campaign"}},
        ],
        "views": [
            {"name": "Board", "type": "board", "config": {"group_field": "Stage"}},
            {"name": "Briefs", "type": "gallery"},
            {"name": "All briefs", "type": "grid"},
        ],
        "rows": [],
        "prefill": None,
    },
}


def catalog() -> list[dict[str, Any]]:
    """What the template picker shows."""
    return [
        {
            "key": key,
            "name": t["name"],
            "description": t["description"],
            "fields": [f["name"] for f in t["fields"]],
            "views": [v["type"] for v in t["views"]],
        }
        for key, t in TEMPLATES.items()
    ]
