"""Bound public connector requests before parsing or database access."""

import asyncio

from starlette.responses import JSONResponse


class NativeRequestSecurity:
    def __init__(self, app, max_bytes=16_384, timeout_seconds=10):
        self.app = app
        self.max_bytes = max_bytes
        self.timeout_seconds = timeout_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if k.lower() not in (b"cache-control", b"referrer-policy")
                ]
                headers.extend(
                    [
                        (b"cache-control", b"no-store"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"x-frame-options", b"DENY"),
                    ]
                )
                message = {**message, "headers": headers}
            await send(message)

        async def reject(code, error):
            await JSONResponse({"error": error}, status_code=code)(scope, receive, secure_send)

        headers = dict(scope.get("headers", []))
        length = headers.get(b"content-length")
        if length is not None:
            try:
                size = int(length)
            except ValueError:
                return await reject(400, "invalid_request")
            if size < 0:
                return await reject(400, "invalid_request")
            if size > self.max_bytes:
                return await reject(413, "request_too_large")
        if headers.get(b"content-encoding", b"identity").lower() != b"identity":
            return await reject(415, "unsupported_content_encoding")

        # Read streaming bodies incrementally; Content-Length is not trusted.
        body = bytearray()
        try:
            async with asyncio.timeout(self.timeout_seconds):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > self.max_bytes:
                        return await reject(413, "request_too_large")
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            return await reject(408, "request_timeout")

        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, secure_send)
