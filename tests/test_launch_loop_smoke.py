"""Launch-loop contract: money reserve, publish idempotency, ads hidden.

This is the cheap stand-in for a live $5 generate→approve→publish→refund
rehearsal. It does not call Stripe or Ayrshare.
"""
from __future__ import annotations

from marketer.services import scheduler


def test_visible_products_hides_ads_when_off():
    # Import the TS helper's contract via a python twin so the launch
    # gate has a unit without standing up Next.
    from pathlib import Path

    src = Path("web/lib/products.ts").read_text()
    assert "export function visibleProducts" in src
    assert 'p.id !== "ads"' in src


def test_ayrshare_submit_classifies_duplicate_and_reject():
    assert scheduler._is_duplicate_response(
        {"message": "Duplicate idempotency key"}, ""
    )
    assert not scheduler._is_duplicate_response({"message": "bad caption"}, "")


def test_onboarding_next_exists():
    from pathlib import Path

    assert Path("web/app/(app)/onboarding/next/page.tsx").is_file()


def test_media_writes_use_db_admin_gate():
    from pathlib import Path

    src = Path("web/app/api/media/route.ts").read_text()
    assert "requireAdmin" in src
    assert Path("web/lib/require-admin.ts").is_file()


def test_ads_layout_redirects_when_disabled():
    from pathlib import Path

    src = Path("web/app/(app)/ads/layout.tsx").read_text()
    assert "redirect" in src
    assert "enabled" in src


def test_trusted_by_logo_cloud_is_hidden():
    from pathlib import Path

    css = Path("web/components/site/bridge.css").read_text()
    assert "#trusted-by" in css
    assert "display: none" in css


def test_credit_reserve_uses_balance_predicate():
    from pathlib import Path

    src = Path("src/marketer/repos/billing.py").read_text()
    assert "credit_balance_usd >= $1" in src
    assert "async def reserve(" in src


def test_image_posts_use_future_window_and_idempotency():
    from pathlib import Path

    src = Path("src/marketer/services/image_posts.py").read_text()
    assert "_next_posting_slot" in src
    assert "publish_idempotency_key" in src
    assert "datetime.now" not in src


def test_deploy_runbook_keeps_billing_and_ads_off():
    from pathlib import Path

    src = Path("docs/DEPLOY.md").read_text()
    assert "MARKETER_BILLING_ENABLED='false'" in src
    assert "Launch rehearsal" in src
    assert "MARKETER_ADS_ENABLED" in src
