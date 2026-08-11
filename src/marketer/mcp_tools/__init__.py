"""Tool modules for the marketer MCP server.

Each module here exposes its tools as plain async functions (so they are
unit-testable without an MCP client) plus a `register(mcp, client_factory)`
that binds them onto the existing `FastMCP` server in
`marketer/mcp_server.py`. Nothing in this package starts a server, owns
auth, or talks to a provider directly — the server owns the transport, the
caller's personal access token owns the scope, and the HTTP API owns
metering.
"""
from __future__ import annotations

from . import media

__all__ = ["media"]
