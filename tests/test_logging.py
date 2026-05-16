from __future__ import annotations

import json
import logging
from io import StringIO

from autocontent.logging import JsonFormatter, configure, get_logger, job_context


def _isolated_handler() -> tuple[logging.Logger, StringIO]:
    """Build a one-off logger with a StringIO sink and the JSON formatter,
    so we don't fight with the module-level configure() global state."""
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(JsonFormatter())
    lg = logging.getLogger(f"test.{id(buf)}")
    lg.handlers.clear()
    lg.addHandler(handler)
    lg.setLevel(logging.INFO)
    lg.propagate = False
    return lg, buf


def test_log_line_is_json_with_context_tags():
    lg, buf = _isolated_handler()
    with job_context(job_id="job-1", user_id="user-1", niche_id="niche-1"):
        lg.info("stage.start", extra={"stage": "ideating"})
    line = buf.getvalue().strip()
    payload = json.loads(line)
    assert payload["msg"] == "stage.start"
    assert payload["stage"] == "ideating"
    assert payload["job_id"] == "job-1"
    assert payload["user_id"] == "user-1"
    assert payload["niche_id"] == "niche-1"
    assert payload["level"] == "INFO"


def test_extra_fields_pass_through():
    lg, buf = _isolated_handler()
    lg.info("spend", extra={
        "provider": "openai", "sku": "gpt-image-1", "cost_usd": "0.042"
    })
    payload = json.loads(buf.getvalue().strip())
    assert payload["provider"] == "openai"
    assert payload["sku"] == "gpt-image-1"
    assert payload["cost_usd"] == "0.042"


def test_context_does_not_leak_after_exit():
    lg, buf = _isolated_handler()
    with job_context(job_id="job-1"):
        lg.info("inside")
    lg.info("outside")
    lines = [json.loads(line) for line in buf.getvalue().splitlines() if line]
    assert lines[0]["job_id"] == "job-1"
    assert "job_id" not in lines[1]


def test_get_logger_is_idempotent():
    """Multiple calls should not pile up handlers on the root logger."""
    configure()
    n = len(logging.getLogger().handlers)
    get_logger("a")
    get_logger("b")
    assert len(logging.getLogger().handlers) == n
