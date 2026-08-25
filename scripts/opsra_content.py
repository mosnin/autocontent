"""Opsra -> marketer.sh content map.

The layout is a transcription and must stay one; only the words and the
brand assets change. Replacements are kept close to the original's
character count on purpose — the Framer layout is built around specific
line breaks, and a heading twice as long reflows the section it sits in.

Every key is matched against the export's exact text node, entities and
all (`&rsquo;`, `&mdash;`). A key that stops matching is reported by the
extractor rather than silently skipped, so a template re-pull cannot
quietly restore Opsra's copy.
"""
from __future__ import annotations

BRAND = "marketer.sh"

# --- text nodes -----------------------------------------------------------
# Ordered roughly as the page reads, for review rather than for execution.
TEXT: dict[str, str] = {
    # nav + global
    "Home": "Home",
    "Features": "Features",
    "process": "how it works",
    "Testimonial": "Results",
    "Pricing": "Pricing",
    "FAQ": "FAQ",
    "Get Started Free": "Start free",
    "Hold tight": "Hold tight",
    "Hang in there": "Almost there",
    "Join our team": "See it run",

    # hero
    "AI productivity": "autonomous marketing",
    "Autopilot your team&rsquo;s": "Autopilot your brand&rsquo;s",
    "Intelligent workflows": "entire content engine",
    "with real-time AI.": "with a cap on spend.",
    "AI WORKFLOWS": "VIDEO &amp; ADS",
    "SMART INSIGHTS": "SEO ARTICLES",

    # letter from the team
    "Hey there": "Hey there",
    "Read more": "Read more",

    # challenges
    "Challenges": "Challenges",
    "Where work breaks down": "Where marketing breaks down",
    "Fragmented workflows": "Scattered tooling",
    "DISCONNECTED SYSTEMS": "DISCONNECTED SYSTEMS",
    "Manual coordination": "Manual production",
    "SLOW TASK EXECUTION": "SLOW CONTENT OUTPUT",
    "Lack of visibility": "Unbounded ad spend",
    "LIMITED TEAM INSIGHTS": "NO HARD BUDGET CAPS",

    # capabilities
    "AI CAPABILITIES": "WHAT IT DOES",
    "Built for speed and intelligence": "Built for output and control",
    "Instant data inputs": "One brief in",
    "Upload files, tasks, or data and let AI instantly structure everything for you.":
        "Describe the niche once and agents plan, script, and storyboard the whole campaign.",
    "Live AI insights": "Live spend visibility",
    "Track progress instantly and make informed decisions without delays.":
        "See the estimate before a job runs and the exact cost the moment it finishes.",
    "Automate workflows": "Produce and publish",
    "SMART TASK EXECUTION": "VIDEO, ADS, ARTICLES",
    "Unify your tools": "Connect your channels",
    "SEAMLESS INTEGRATIONS": "SEAMLESS INTEGRATIONS",
    "Track performance": "Track performance",
    "REAL-TIME INSIGHTS": "REAL-TIME INSIGHTS",
    "Scale with clarity": "Scale under a cap",
    "CONSISTENT TEAM OUTPUT": "PREDICTABLE MONTHLY SPEND",
    "CONSISTENT OUTPUT": "PREDICTABLE SPEND",

    # workflow
    "AI WORKFLOW": "HOW IT RUNS",
    "Simple steps to get started": "Simple steps to get started",
    "Connect": "Brief",
    "Process": "Produce",
    "Execute": "Publish",
    "Step: 1": "Step: 1",
    "Step: 2": "Step: 2",
    "Step: 3": "Step: 3",
    "Connect your data": "Write one brief",
    "Integrate your tools, upload files, and sync multiple data sources to unify workflows, giving your team one centralized and intelligent system.":
        "Name the niche, the channels, and the daily budget. That brief is the only input the system needs to start producing.",
    "Seamless integrations across tools": "One brief, every channel",
    "AI processes everything": "Agents produce it",
    "AI analyses incoming data, structures complex information, and automates repetitive tasks to streamline operations without requiring manual effort.":
        "Agents ideate, script, render, voice, and caption every asset, checking each one against your brand kit before it moves on.",
    "Automated workflows powered by AI": "Video, ads, and articles in one pass",
    "Execute with precision": "Publish and improve",
    "Trigger automated actions, generate real-time insights, and continuously optimise performance across workflows with fast and intelligent execution.":
        "Approved work publishes on schedule, performance feeds back into the next brief, and every dollar stays inside its cap.",
    "Real-time execution and optimization": "Scheduled, measured, and capped",

    # social proof
    "SOCIAL PROOF": "RESULTS",
    "Powering modern teams with AI": "Built for teams shipping every day",
    "Faster workflow execution": "More content shipped",
    "Reduction in manual tasks": "Less manual production",
    "Smarter decision making": "Faster brief to first cut",
    "Increase in team output": "Of spend under a hard cap",
    "&ldquo;This platform has completely transformed how our team works. Everything feels faster, clearer, and more aligned.&rdquo;":
        "&ldquo;We brief it once on Monday and spend the rest of the week reviewing, not producing. The cap means finance stopped asking.&rdquo;",
    "Wei Chen": "Wei Chen",
    "Built for speed, clarity, and high-performing teams across modern workflows.":
        "Built for speed, control, and teams that ship content every single day.",

    # integrations
    "integrations": "integrations",
    "AI that connects everything": "Publishes where you already are",
    "50+ integrations": "50+ integrations",
    "Upload files, tasks, or data and let AI instantly":
        "Connect a channel once and it publishes there forever",

    # comparison
    "COMPARISON": "COMPARISON",
    "Built different from day one": "Built different from day one",
    "Other Companies": "Other tools",
    "Tool Overload": "Tool Overload",
    "Reactive Decisions": "Blind Spend",
    "Fragmented Workflows": "Fragmented Output",
    "Manual Processes": "Manual Production",
    "Delayed Insights": "Delayed Reporting",
    "Siloed Data": "Siloed Assets",
    "All-in-One System": "All-in-One System",
    "Proactive Decisions": "Capped Spend",
    "Unified Workflows": "Unified Output",
    "AI Automation": "Agent Automation",
    "Real-time Insights": "Real-time Reporting",
    "Connected Data": "Connected Channels",
    "Unified workflows with AI-driven automation":
        "Unified production with agent-driven automation",
    "Real-time insights that drive faster decisions":
        "Hard budget caps the system cannot cross",

    # pricing
    "pricing": "pricing",
    "Simple plans for smarter teams": "Prepaid credits, never a subscription",
    "Basic Plan": "Starter pack",
    "$999": "$5",
    "$1999": "$50",
    "/month": "one-time",
    "month": "one-time",
    "Perfect for teams looking to automate workflows and improve daily productivity.":
        "Enough to run a niche for a week and see the whole pipeline end to end.",
    "AI-powered task automation across workflows": "Agent-run video, ads, and SEO articles",
    "Real-time data syncing and integrations": "Publishing to every connected channel",
    "Smart insights for better decision making": "Per-niche and global daily spend caps",
    "Workflow tracking and performance metrics": "Cost estimate before every single job",
    "Secure and scalable cloud infrastructure": "Credits never expire, no card on file",
    "get started": "get started",
    "Most Popular": "Most Popular",
    "Perfect for teams scaling operations with advanced automation and deeper insights.":
        "For teams running several niches at once with approval gates and audit trails.",
    "Advanced AI automation with custom workflows": "Everything in Starter, across unlimited niches",
    "Predictive insights and performance analytics": "Human approval gates before publish or spend",
    "Priority processing and faster execution speed": "Priority rendering and faster queue position",
    "Team-wide collaboration and access controls": "Per-client brand kits and scoped API keys",
    "Dedicated support and onboarding assistance": "Full audit trail of every dollar and asset",
    "Curious how it works in real teams? Check out their stories":
        "Want the exact cost per video? Read the pricing breakdown",
    "here": "here",

    # faq
    "Everything you want to know": "Everything you want to know",
    "What does Opsra actually help teams achieve?":
        f"What does {BRAND} actually do for a team?",
    "Opsra helps teams streamline workflows, improve collaboration, and deliver high-quality output consistently. It brings clarity to tasks, reduces back-and-forth, and ensures everyone stays aligned on goals and execution.":
        f"{BRAND} turns one written brief into finished video, ads, and SEO articles, then schedules and publishes them to your channels. Agents handle ideation, production, and QA; you review and approve, and every dollar spent stays inside a cap you set.",
    "Is Opsra suitable for small teams or only large organizations?":
        f"Is {BRAND} worth it for a solo operator?",
    "How does Opsra improve team productivity?":
        f"How does {BRAND} keep costs predictable?",
    "Can we use Opsra with our existing tools?":
        f"Can {BRAND} publish to the channels we already use?",
    "How quickly can teams get started using Opsra?":
        f"How quickly can we get the first video out?",
    "What makes Opsra different from other solutions?":
        f"What makes {BRAND} different from other AI tools?",

    # cta + footer
    "CTA": "CTA",
    "Build faster.  Work smarter.": "Ship faster.  Spend less.",
    "Designed to help teams automate processes and focus on what truly matters.":
        "Built so a single brief becomes a week of published work, under a budget you set.",
    "The Future of Team Operations": "Marketing That Runs Itself",
    "Pages": "Pages",
    "Contact": "Contact",
    "Privacy policy": "Privacy policy",
    "Terms &amp; conditions": "Terms &amp; conditions",
    "Copyright &copy; 2026 OPSRA": "Copyright &copy; 2026 MARKETER.SH",
}

# --- per-character split headline ----------------------------------------
# Rendered one <span> per character for a staggered reveal. The extractor
# rebuilds the run from this string, so length is free here.
SPLIT_TEXT: dict[str, str] = {
    "Teams today operate across too many tools, leading to missed updates, delayed execution, and constant back-and-forth. Work gets scattered, priorities become unclear, and even high-performing teams struggle to maintain consistency. We&rsquo;re building a system where workflows are unified, execution is streamlined, and every team member has clear visibility &mdash; enabling faster decisions, better alignment, and predictable outcomes.":
        "Marketing teams run a dozen tools to ship one campaign, and the work still arrives late. Briefs sit in docs, production waits on a person, and spend is only understood after the invoice lands. We&rsquo;re building the opposite: one brief becomes finished video, ads, and articles, published on schedule &mdash; with a hard cap on every dollar, enforced before the money moves.",
}

# --- attribute text -------------------------------------------------------
ATTRS: dict[str, str] = {
    # Matched whitespace-insensitively, so this covers both the nav
    # (`alt="opsra logo\n"`) and the footer (`alt="opsra logo"`).
    "opsra logo": f"{BRAND} logo",
    "opsra footer logo": f"{BRAND} wordmark",
    "opsra company bg image ": "Abstract background",
    "Middle Framer": "Middle Frame",
}

# --- brand assets ---------------------------------------------------------
# Opsra's own marks, replaced with ours. Values are paths under web/public.
ASSETS: dict[str, str] = {
    "images/siIFu0bYmAWkX5McUDj8I0vg1wU.c1fc9.svg": "/brand/marketer-logo.svg",
    "images/OkN37FoPd9rtocGcOIXc1rDRXw.9a21f.svg": "/brand/marketer-logo.svg",
    "images/4d2XWuCXy75uRvv35lwdP6LXY.ca844.png": "/brand/marketer-wordmark.svg",
    "images/lfeZiiae73i8RP2GmJfKrw9zJs.f7a17.png": "/brand/marketer-wordmark.svg",
}

# --- internal navigation --------------------------------------------------
# Framer's static export flattens every internal link to the exported file
# name: a nav item, a footer link and a call to action all come out as
# `href="index.html"` or `href="contact-us.html"`, and a link the design file
# never wired up comes out with no href at all. Nothing in the export says
# where any of them was meant to go.
#
# So they are not recovered — they are *replaced*. The template's information
# architecture (Home / Features / process / Testimonial / Pricing / FAQ) is
# not ours; the site it now wears the design of has its own, and this map is
# where the two are reconciled. The destinations and the labels below come
# from `web/components/marketing/system/nav.tsx`, which is the original
# site's navigation and the source of truth for both.
#
# Keyed by zone first, because the export reuses the same word in places that
# must not go to the same page — "Home" is a nav item, a footer link and a
# footer column heading; "Get Started Free" is both the nav button and the
# hero button. Zone is the anchor's nearest `<nav>` / `<footer>` ancestor, or
# `body` for everything in the page itself. Two keys carry a suffix the
# extractor appends from the DOM:
#   "@<layer name>"  the link has no text of its own (the logo)
#   " @current"      Framer marks a *page* link pointing at the page you are
#                    on with data-framer-page-link-current; that is what
#                    separates the footer's "Pages > Home" from the "Home"
#                    one column to its left.
#
# Each value is (href, label). A label of None leaves the link's words alone,
# for the ones whose copy the TEXT map above already owns. Every label given
# here is protected from the TEXT pass afterwards, so "Home" as a nav label
# and "Home" as a column heading can differ.
HREFS: dict[str, dict[str, tuple[str, str | None]]] = {
    # The top bar. Six text slots and one button, against our six top-level
    # destinations. "Features" keeps its word: the Product dropdown is
    # attached to that item by name.
    "nav": {
        "@Logo":            ("/", None),
        "Home":             ("/", "Home"),
        "Features":         ("/features", "Features"),
        "process":          ("/use-cases", "Use cases"),
        "Testimonial":      ("/resources", "Resources"),
        "Pricing":          ("/pricing", "Pricing"),
        "FAQ":              ("/company", "Company"),
        "Get Started Free": ("/sign-up", "Sign up"),
    },
    # The footer's first column repeats the top-level routes (its heading
    # becomes "Product" via the TEXT map); the second column, headed "Pages",
    # holds the ones that are not product pages. The two legal links at the
    # very bottom are the only place terms and privacy are linked, so they
    # keep their own words.
    "footer": {
        "Home":                   ("/features", "Platform"),
        "Features":               ("/use-cases", "Use cases"),
        "Process":                ("/resources", "Resources"),
        "Testimonial":            ("/pricing", "Pricing"),
        "Pricing":                ("/company", "Company"),
        "Home @current":          ("/", "Home"),
        "Contact":                ("/company", "Contact sales"),
        "Privacy policy":         ("/legal/privacy", "Privacy policy"),
        "Terms &amp; conditions": ("/legal/terms", "Terms &amp; conditions"),
    },
    # In the page itself. These keep their copy — the TEXT map above writes
    # it — and only gain a destination. The three workflow tabs are the
    # section's own Brief / Produce / Publish steps, so each one goes to the
    # page that explains that step.
    "body": {
        "Get Started Free": ("/sign-up", None),        # hero
        "get started":      ("/sign-up", None),        # pricing + closing CTA
        "Read more":        ("/company", None),        # signs off the hero letter
        "Connect":          ("/resources/quickstart", None),   # "Brief"
        "Process":          ("/features/video", None),         # "Produce"
        "Execute":          ("/features/analytics", None),     # "Publish"
    },
}

# --- outbound links -------------------------------------------------------
# NOTE: the social handles below are placeholders following the usual
# convention. Swap them for the real accounts before this goes live —
# they currently point at profiles we do not control.
LINKS: dict[str, str] = {
    "https://x.com/Praha37v": "/pricing",
    "https://x.com": "https://x.com/marketersh",
    "https://www.instagram.com": "https://www.instagram.com/marketersh",
    "https://www.facebook.com/": "https://www.facebook.com/marketersh",
    "https://www.youtube.com/": "https://www.youtube.com/@marketersh",
}
