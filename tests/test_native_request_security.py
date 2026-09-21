import asyncio

import pytest

from backend.native_request_security import NativeRequestSecurity


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers,chunks,expected",
    [
        ([(b"content-length", b"1000000")], [], 413),
        ([(b"content-length", b"invalid")], [], 400),
        ([(b"content-length", b"-1")], [], 400),
        ([(b"content-encoding", b"gzip")], [], 415),
        ([], [b"x" * 10, b"y" * 10], 413),
        ([], [b"ok"], 200),
    ],
)
async def test_bounds_streams_before_app_and_prevents_cache(headers, chunks, expected):
    called = False
    messages = []
    chunks = list(chunks)

    async def downstream(scope, receive, send):
        nonlocal called
        called = True
        assert (await receive())["body"] == b"ok"
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"cache-control", b"public")],
            }
        )
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        chunk = chunks.pop(0)
        return {"type": "http.request", "body": chunk, "more_body": bool(chunks)}

    async def send(message):
        messages.append(message)

    await NativeRequestSecurity(downstream, max_bytes=16)(
        {"type": "http", "method": "POST", "headers": headers}, receive, send
    )
    assert messages[0]["status"] == expected
    assert called == (expected == 200)
    assert dict(messages[0]["headers"])[b"cache-control"] == b"no-store"
    assert dict(messages[0]["headers"])[b"referrer-policy"] == b"no-referrer"


@pytest.mark.asyncio
async def test_slow_body_times_out_before_app():
    messages = []

    async def downstream(*args):
        pytest.fail("slow body reached application")

    async def receive():
        await asyncio.sleep(1)

    async def send(message):
        messages.append(message)

    await NativeRequestSecurity(downstream, timeout_seconds=0.01)(
        {"type": "http", "method": "POST", "headers": []}, receive, send
    )
    assert messages[0]["status"] == 408
