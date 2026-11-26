"""WordPress client: SSRF refusals, pinned connections, payloads, errors. No network."""
from __future__ import annotations

import json

import httpx
import pytest

from marketer.services import ssrf
from marketer.services.wordpress import (
    PostInput, WordPressClient, WordPressRefused, WordPressSite, normalize_site_url, seo_meta,
)
from tests.seo_fakes import FakeWordPress, public_resolver


def _site(url: str = "https://blog.example.com", plugin: str = "yoast") -> WordPressSite:
    return WordPressSite(site_url=url, username="editor", app_password="abcd efgh ijkl mnop", seo_plugin=plugin)


def _post(live: bool = False) -> PostInput:
    return PostInput(
        title="Cold Brew", html="<p>x</p>", slug="cold-brew", excerpt="desc", meta_title="Cold Brew Guide",
        meta_description="desc", focus_keyword="cold brew", secondary_keywords=("iced coffee",), live=live,
    )


@pytest.mark.parametrize("url", [
    "http://blog.example.com", "ftp://blog.example.com", "https://user:pw@blog.example.com",
    "https://blog.example.com/?x=1", "https://blog.example.com/#a", "https://", "not a url",
])
def test_site_url_syntax_refused(url):
    with pytest.raises(WordPressRefused):
        normalize_site_url(url)


def test_site_url_normalized():
    assert normalize_site_url("https://Blog.Example.com/wp-admin/") == "https://blog.example.com"
    assert normalize_site_url("https://example.com/blog/wp-json/wp/v2") == "https://example.com/blog"


@pytest.mark.parametrize("url", [
    "https://127.0.0.1", "https://10.0.0.5", "https://169.254.169.254", "https://[::1]",
    "https://192.168.1.10", "https://metadata.google.internal",
])
async def test_private_and_metadata_addresses_refused_before_any_request(url):
    wp = FakeWordPress()
    client = WordPressClient(_site(url), transport=wp.transport, resolver=ssrf.resolve_public_url)
    with pytest.raises(WordPressRefused) as e:
        await client.verify()
    assert "won't connect" in e.value.message
    assert wp.requests == []


async def test_host_resolving_to_private_address_refused():
    wp = FakeWordPress()
    client = WordPressClient(_site(), transport=wp.transport, resolver=lambda u: (False, "host resolves to a non-public address (10.1.2.3)", None))
    with pytest.raises(WordPressRefused):
        await client.verify()
    assert wp.requests == []


async def test_connects_to_the_checked_address_with_host_header_and_basic_auth():
    wp = FakeWordPress()
    info = await WordPressClient(_site(), transport=wp.transport, resolver=public_resolver).verify()
    assert info["can_publish"] is True
    req = wp.requests[0]
    assert req.url.host == "93.184.216.34"
    assert req.headers["host"] == "blog.example.com"
    assert req.headers["authorization"].startswith("Basic ")
    assert "abcd efgh" not in req.headers["authorization"]  # spaces stripped, then encoded


async def test_redirect_is_refused_not_followed():
    def handler(request):
        return httpx.Response(301, headers={"location": "https://10.0.0.1/"})

    client = WordPressClient(_site(), transport=httpx.MockTransport(handler), resolver=public_resolver)
    with pytest.raises(WordPressRefused) as e:
        await client.verify()
    assert e.value.status == 301


async def test_bad_credentials_are_a_definite_refusal():
    wp = FakeWordPress(fail=401)
    with pytest.raises(WordPressRefused) as e:
        await WordPressClient(_site(), transport=wp.transport, resolver=public_resolver).verify()
    assert e.value.status == 401


async def test_server_error_propagates_as_http_error_for_unknown_outcome():
    wp = FakeWordPress(fail=503)
    with pytest.raises(httpx.HTTPStatusError):
        await WordPressClient(_site(), transport=wp.transport, resolver=public_resolver).publish(_post())


@pytest.mark.parametrize("plugin,keys", [
    ("yoast", {"_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_focuskw"}),
    ("rankmath", {"rank_math_title", "rank_math_description", "rank_math_focus_keyword"}),
])
async def test_publish_sends_seo_plugin_fields(plugin, keys):
    wp = FakeWordPress()
    result = await WordPressClient(_site(plugin=plugin), transport=wp.transport, resolver=public_resolver).publish(_post())
    body = json.loads(wp.requests[0].content)
    assert set(body["meta"]) == keys
    assert body["status"] == "draft" and body["slug"] == "cold-brew"
    assert result.post_id == 321 and result.edit_url.endswith("post=321&action=edit")
    if plugin == "rankmath":
        assert body["meta"]["rank_math_focus_keyword"] == "cold brew,iced coffee"


def test_no_seo_plugin_sends_no_meta():
    assert seo_meta("none", _post()) == {}


async def test_silently_demoted_publish_is_refused_with_post_id():
    wp = FakeWordPress(status_after_publish="pending")
    with pytest.raises(WordPressRefused) as e:
        await WordPressClient(_site(), transport=wp.transport, resolver=public_resolver).publish(_post(live=True))
    assert e.value.post_id == 321
    assert "Editor or Administrator" in e.value.message


async def test_update_targets_existing_post():
    wp = FakeWordPress()
    await WordPressClient(_site(), transport=wp.transport, resolver=public_resolver).publish(_post(), existing_id=55)
    assert wp.requests[0].url.path.endswith("/wp-json/wp/v2/posts/55")


def test_password_not_in_repr():
    assert "abcd" not in repr(_site())
