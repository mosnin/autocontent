"""SEO metadata rules, the safe HTML renderer and secret sealing."""
from __future__ import annotations

import base64

import pytest

from marketer.articles import html as article_html
from marketer.articles import seo_meta
from marketer.config import settings
from marketer.services import secret_box

# ── metadata ─────────────────────────────────────────────────────────────────


def test_fit_cuts_at_a_word_boundary():
    text = "How to make smooth cold brew coffee at home with a mason jar and filter"
    out = seo_meta.fit(text, 60)
    assert len(out) <= 60 and text.startswith(out) and not out.endswith(" ")
    assert seo_meta.fit("short", 60) == "short"


@pytest.mark.parametrize("raw,slug", [
    ("Cold Brew: The Guide!", "cold-brew-the-guide"),
    ("Café crème — à la maison", "cafe-creme-a-la-maison"),
    ("--a--b--", "a-b"),
    ("x" * 120, "x" * 80),
])
def test_slugify(raw, slug):
    assert seo_meta.slugify(raw) == slug


def test_slugify_cuts_at_hyphen():
    out = seo_meta.slugify(" ".join(["word"] * 30))
    assert len(out) <= 80 and not out.endswith("-") and out.endswith("word")


def test_normalize_fits_model_output():
    m = seo_meta.normalize(
        meta_title="A" * 80, meta_description="word " * 60, slug="Bad Slug!!",
        focus_keyword="cold brew", secondary_keywords=["Cold Brew", "iced coffee", "ICED COFFEE", ""] + [f"k{i}" for i in range(20)],
    )
    assert len(m.meta_title) <= 60 and len(m.meta_description) <= 155
    assert m.slug == "bad-slug"
    assert m.secondary_keywords[0] == "iced coffee"
    assert "Cold Brew" not in m.secondary_keywords and len(m.secondary_keywords) == 10


def _valid(**kw):
    base = dict(meta_title="Cold Brew Guide", meta_description="Make cold brew.", slug="cold-brew",
                focus_keyword="cold brew", secondary_keywords=["iced coffee"])
    base.update(kw)
    return seo_meta.validate(**base)


def test_validate_accepts_good_metadata():
    assert _valid() == {}


@pytest.mark.parametrize("kw,field", [
    ({"meta_title": "x" * 61}, "meta_title"),
    ({"meta_title": "  "}, "meta_title"),
    ({"meta_description": "x" * 156}, "meta_description"),
    ({"slug": "Cold Brew"}, "slug"),
    ({"slug": "cold--brew"}, "slug"),
    ({"slug": "x" * 81}, "slug"),
    ({"focus_keyword": ""}, "focus_keyword"),
    ({"secondary_keywords": ["a"] * 11}, "secondary_keywords"),
    ({"secondary_keywords": ["Cold Brew"]}, "secondary_keywords"),
    ({"secondary_keywords": ["x", "X"]}, "secondary_keywords"),
    ({"secondary_keywords": ["x" * 61]}, "secondary_keywords"),
])
def test_validate_refuses(kw, field):
    assert field in _valid(**kw)


def test_limits_are_the_boundaries():
    assert _valid(meta_title="x" * 60, meta_description="y" * 155) == {}


# ── HTML ─────────────────────────────────────────────────────────────────────


def test_markdown_renders_and_drops_leading_h1():
    out = article_html.to_html("# Title\n\n## Why\n\nSome **bold** and *it* text.\n\n- one\n- two\n\n1. a\n2. b\n\n> quoted")
    assert "<h1>" not in out
    assert "<h2>Why</h2>" in out and "<strong>bold</strong>" in out and "<em>it</em>" in out
    assert "<ul><li>one</li><li>two</li></ul>" in out and "<ol><li>a</li><li>b</li></ol>" in out
    assert "<blockquote>" in out


def test_raw_html_and_script_links_never_pass_through():
    out = article_html.to_html('Hi <script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.test/p) <img src=x onerror=1>')
    assert "<script>" not in out and "<img" not in out
    assert "javascript:" not in out
    assert '<a href="https://a.test/p">ok</a>' in out


def test_link_attribute_cannot_break_out():
    out = article_html.to_html('[x](https://a.test/"onmouseover="1)')
    assert 'onmouseover="1' not in out


def test_cover_figure_credits_unsplash_and_rejects_other_hosts():
    cover = {
        "source": "unsplash", "url": "https://images.unsplash.com/photo-1", "alt": "jar",
        "author_name": "Ana <b>", "author_url": "https://unsplash.com/@ana?utm_source=marketer&utm_medium=referral",
        "unsplash_url": "https://unsplash.com/?utm_source=marketer&utm_medium=referral",
    }
    fig = article_html.cover_figure(cover)
    assert "Photo by" in fig and "Unsplash" in fig and "Ana &lt;b&gt;" in fig
    assert article_html.cover_figure({**cover, "url": "https://evil.test/x.png"}) == ""
    assert article_html.cover_figure(None) == ""


# ── secret sealing ───────────────────────────────────────────────────────────


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(settings, "integration_secret_key", base64.b64encode(b"s" * 32).decode())


def test_seal_roundtrip_and_never_plaintext(key):
    sealed = secret_box.seal("app pass word", purpose="wordpress.app_password", tenant_id="t1")
    assert sealed.startswith("v1:") and "app pass" not in sealed
    assert secret_box.open_sealed(sealed, purpose="wordpress.app_password", tenant_id="t1") == "app pass word"


def test_sealed_value_is_bound_to_tenant_and_purpose(key):
    sealed = secret_box.seal("pw", purpose="wordpress.app_password", tenant_id="t1")
    with pytest.raises(secret_box.SecretUnreadable):
        secret_box.open_sealed(sealed, purpose="wordpress.app_password", tenant_id="t2")
    with pytest.raises(secret_box.SecretUnreadable):
        secret_box.open_sealed(sealed, purpose="other", tenant_id="t1")


def test_no_key_refuses_to_seal(monkeypatch):
    monkeypatch.setattr(settings, "integration_secret_key", "")
    assert not secret_box.available()
    with pytest.raises(secret_box.SecretsUnavailable):
        secret_box.seal("pw", purpose="p", tenant_id="t")


def test_short_key_refused(monkeypatch):
    monkeypatch.setattr(settings, "integration_secret_key", base64.b64encode(b"short").decode())
    with pytest.raises(secret_box.SecretsUnavailable):
        secret_box.seal("pw", purpose="p", tenant_id="t")
