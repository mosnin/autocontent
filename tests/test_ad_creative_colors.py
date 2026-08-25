"""Hex -> HSL -> prompt-safe phrase, and domain canonicalization.

The single most important assertion in this file is that no function
here ever returns something containing a "#": an image model handed a
raw code prints it onto the artwork.
"""
from __future__ import annotations

from marketer.adcreative.colors import (
    FALLBACK_COLOR_A,
    FALLBACK_COLOR_B,
    describe_color,
    hex_to_hsl,
    normalize_brand_color_hex,
    pick_brand_colors,
)
from marketer.adcreative.domains import (
    normalize_domain,
    normalize_public_http_url,
)


def test_hex_normalization():
    assert normalize_brand_color_hex("#543CFC") == "#543cfc"
    assert normalize_brand_color_hex("543cfc") == "#543cfc"
    assert normalize_brand_color_hex(" #ABC ") == "#abc"
    assert normalize_brand_color_hex("#12345") is None
    assert normalize_brand_color_hex("rebeccapurple") is None
    assert normalize_brand_color_hex("") is None


def test_shorthand_hex_expands():
    full = hex_to_hsl("#ffffff")
    short = hex_to_hsl("#fff")
    assert full is not None and short is not None
    assert round(full.lightness) == round(short.lightness) == 100


def test_describe_color_families():
    assert describe_color("#543cfc") == "vivid indigo"
    assert describe_color("#0a1f44") == "deep navy"
    assert describe_color("#ffffff") == "off-white"
    assert describe_color("#000000") == "near-black"
    assert describe_color("#808080") == "slate gray"


def test_describe_color_never_emits_hex():
    for value in ("#543cfc", "#00ff00", "#123", "#fa0", "not-a-color"):
        assert "#" not in describe_color(value)


def test_describe_color_falls_back_on_garbage():
    assert describe_color("chartreuse") == FALLBACK_COLOR_B
    # Trailing data and alpha channels are refused, not truncated.
    assert describe_color("#ffffffjunk") == FALLBACK_COLOR_B
    assert describe_color("#00000000") == FALLBACK_COLOR_B


def test_pick_brand_colors_prefers_vivid_midtone_then_a_distinct_second():
    a, b = pick_brand_colors(["#f4f4f5", "#543cfc", "#0a1f44"])
    assert a == "vivid indigo"
    assert b != a
    assert "#" not in a and "#" not in b


def test_pick_brand_colors_second_is_visibly_different():
    a, b = pick_brand_colors(["#ff0000", "#0000ff"])
    assert a != b
    assert "#" not in a and "#" not in b


def test_pick_brand_colors_falls_back_on_empty_palette():
    assert pick_brand_colors([]) == (FALLBACK_COLOR_A, FALLBACK_COLOR_B)
    assert pick_brand_colors(["nonsense", "#zzz"]) == (FALLBACK_COLOR_A, FALLBACK_COLOR_B)


def test_pick_brand_colors_single_color_still_returns_a_pair():
    a, b = pick_brand_colors(["#543cfc"])
    assert a == "vivid indigo"
    assert b == FALLBACK_COLOR_B


def test_normalize_domain_canonicalizes():
    assert normalize_domain("https://www.stripe.com/pricing") == "stripe.com"
    assert normalize_domain("  STRIPE.com ") == "stripe.com"
    assert normalize_domain("sub.example.co.uk") == "sub.example.co.uk"


def test_normalize_domain_rejects_private_and_internal_hosts():
    for value in (
        "localhost",
        "http://127.0.0.1",
        "10.0.0.5",
        "192.168.1.1",
        "172.16.9.9",
        "169.254.169.254",
        "metadata.google.internal",
        "buildbox.internal",
        "printer.local",
        "http://[::1]",
        "",
        "not a domain",
        "com",
    ):
        assert normalize_domain(value) is None, value


def test_normalize_public_http_url_guards_logo_urls():
    assert normalize_public_http_url("https://cdn.stripe.com/logo.png")
    assert normalize_public_http_url("http://169.254.169.254/logo.png") is None
    assert normalize_public_http_url("file:///etc/passwd") is None
    assert normalize_public_http_url(None) is None
    assert normalize_public_http_url("https://x.test/" + "a" * 4000) is None
