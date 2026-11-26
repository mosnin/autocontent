"""Replay the decision-model conformance cases as a Braintrust experiment.

    python scripts/braintrust_decisions_eval.py              # replay recorded responses
    python scripts/braintrust_decisions_eval.py --live       # ask the real decisions endpoint
    python scripts/braintrust_decisions_eval.py --dry-run    # score only, upload nothing

The cases are the golden files in docs/decisions/conformance/ that the Python
and TypeScript decision clients both replay (tests/test_decisions_conformance.py).

- **replay** (default, no model calls): each case's recorded response goes
  through ``DecisionClient`` via a mock transport. Score ``conformance`` is 1
  when the client reaches the outcome the case expects (the same answers, or
  the same typed failure). This tracks the client against the contract.
- **live** (``--live``, needs ``OPENROUTER_API_KEY``): each case that expects
  answers is sent to the decisions endpoint with its model. Scores: ``ok``
  (an answer came back), ``agreement`` (share of questions that agree with the
  recorded answer: same side of 0.5 for yes/no, same option, same level).
  This tracks the models.

Results are uploaded as one experiment (``POST /v1/experiment``, then
``POST /v1/experiment/{id}/insert``) when ``BRAINTRUST_API_KEY`` and
``BRAINTRUST_PROJECT_ID`` are set; otherwise only the summary is printed. The
key is read from the environment and never printed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "docs" / "decisions" / "conformance"
DEFAULT_API_URL = "https://api.braintrust.dev"
INSERT_BATCH = 100
HTTP_TIMEOUT_SEC = 30.0

# The two clients name one failure kind differently; the meaning is the same.
_KIND = {"network": "transport"}


@dataclass
class CaseResult:
    name: str
    input: dict[str, Any]
    expected: dict[str, Any]
    output: dict[str, Any]
    scores: dict[str, float]
    metadata: dict[str, Any] = field(default_factory=dict)

    def event(self) -> dict[str, Any]:
        return {
            "input": self.input,
            "output": self.output,
            "expected": self.expected,
            "scores": self.scores,
            "metadata": {"case": self.name, **self.metadata},
            "tags": ["decisions", "conformance"],
        }


# ---------------------------------------------------------------------- cases


def load_cases(directory: Path = CASES_DIR) -> list[dict[str, Any]]:
    contract = json.loads((directory / "contract.json").read_text())
    return [json.loads((directory / f"{name}.json").read_text()) for name in contract["cases"]]


def _questions(spec: dict[str, Any]):
    from marketer.decisions import questions as q  # noqa: PLC0415

    out: dict[str, Any] = {}
    for name, s in spec.items():
        if s["type"] == "yesno":
            out[name] = q.YesNo(s["instructions"])
        elif s["type"] == "choice":
            out[name] = q.Choice(s["instructions"], dict(s["options"]))
        else:
            out[name] = q.Score(s["instructions"], tuple(s["levels"]))
    return out


def _normalize_answers(case: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """The Python client keeps a score as ``level`` plus a 0..1 ``score``; the
    contract gives the level as ``score``. Compare in the contract's terms."""
    out: dict[str, Any] = {}
    for name, got in answers.items():
        got = dict(got)
        if got.get("type") == "score" and "level" in got:
            got["score"] = got.pop("level")
        out[name] = got
    return out


def _input(case: dict[str, Any]) -> dict[str, Any]:
    return {"model": case["model"], "state": case["state"], "questions": case["questions"]}


async def replay_case(case: dict[str, Any]) -> CaseResult:
    from marketer.services import decisions as svc  # noqa: PLC0415

    async def handle(request: httpx.Request) -> httpx.Response:
        resp = case["response"]
        if "raw" in resp:
            return httpx.Response(resp["status"], text=resp["raw"])
        return httpx.Response(resp["status"], json=resp["body"])

    client = svc.DecisionClient(key="replay-only", transport=httpx.MockTransport(handle))
    expect = case["expect"]
    try:
        raw = await client.decide(case["state"], _questions(case["questions"]), model=case["model"], timeout_s=5)
    except svc.DecisionError as e:
        output = {"ok": False, "kind": e.kind}
        passed = not expect["ok"] and e.kind == _KIND.get(expect["kind"], expect["kind"])
    else:
        answers = _normalize_answers(case, raw.answers)
        output = {"ok": True, "model": raw.model, "answers": answers, "cost": float(raw.cost_usd), "tokens": raw.tokens}
        passed = bool(expect["ok"]) and answers == expect.get("answers") and raw.cost_usd == Decimal(str(expect["cost"]))
    return CaseResult(
        name=case["name"],
        input=_input(case),
        expected=expect,
        output=output,
        scores={"conformance": 1.0 if passed else 0.0},
        metadata={"mode": "replay", "source": case.get("source", "")},
    )


def agreement(case: dict[str, Any], answers: dict[str, Any]) -> float:
    """Share of questions where a live answer agrees with the recorded one."""
    want = case["expect"].get("answers") or {}
    if not want:
        return 0.0
    hits = 0
    for name, w in want.items():
        g = answers.get(name) or {}
        if w.get("type") == "yesno":
            if "probability" in g:
                hits += int((float(g["probability"]) >= 0.5) == (float(w.get("probability", 0)) >= 0.5))
        elif w.get("type") == "choice":
            hits += int(g.get("choice") == w.get("choice"))
        elif "score" in g:
            # Same level: the recorded score rounded to its nearest level.
            hits += int(round(float(g["score"])) == round(float(w.get("score", -1))))
    return hits / len(want)


async def live_case(case: dict[str, Any], *, client: Any = None) -> CaseResult:
    from marketer.services import decisions as svc  # noqa: PLC0415

    http = client or svc.DecisionClient()
    t0 = time.monotonic()
    try:
        raw = await http.decide(case["state"], _questions(case["questions"]), model=case["model"], timeout_s=30)
    except svc.DecisionError as e:
        output: dict[str, Any] = {"ok": False, "kind": e.kind}
        scores = {"ok": 0.0, "agreement": 0.0}
    else:
        answers = _normalize_answers(case, raw.answers)
        output = {"ok": True, "model": raw.model, "answers": answers, "cost": float(raw.cost_usd), "tokens": raw.tokens}
        scores = {"ok": 1.0, "agreement": agreement(case, answers)}
    return CaseResult(
        name=case["name"],
        input=_input(case),
        expected=case["expect"],
        output=output,
        scores=scores,
        metadata={"mode": "live", "latency_ms": int((time.monotonic() - t0) * 1000)},
    )


async def run(mode: str, cases: list[dict[str, Any]]) -> list[CaseResult]:
    if mode == "live":
        return [await live_case(c) for c in cases if c["expect"].get("ok")]
    return [await replay_case(c) for c in cases]


def summary(results: list[CaseResult]) -> dict[str, float]:
    totals: dict[str, list[float]] = {}
    for r in results:
        for k, v in r.scores.items():
            totals.setdefault(k, []).append(v)
    return {k: round(sum(v) / len(v), 4) for k, v in totals.items() if v}


# ---------------------------------------------------------------------- upload


def braintrust_config(env: dict[str, str] | None = None) -> tuple[str, str, str] | None:
    env = dict(os.environ if env is None else env)
    key = env.get("BRAINTRUST_API_KEY", "").strip()
    project = env.get("BRAINTRUST_PROJECT_ID", "").strip()
    if not key or not project:
        return None
    url = (env.get("BRAINTRUST_API_URL", "") or DEFAULT_API_URL).strip().rstrip("/")
    return key, project, url


def experiment_name(mode: str, env: dict[str, str] | None = None) -> str:
    env = dict(os.environ if env is None else env)
    rev = (env.get("GITHUB_SHA") or "")[:12] or time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    return f"decisions-{mode}-{rev}"


def upload(
    results: list[CaseResult],
    *,
    mode: str,
    key: str,
    project_id: str,
    api_url: str,
    base_experiment_id: str | None = None,
    transport: httpx.BaseTransport | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Create the experiment and insert one event per case. Returns the created
    experiment (its ``id`` and, when the API gives one, a link)."""
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body: dict[str, Any] = {
        "project_id": project_id,
        "name": experiment_name(mode, env),
        "description": f"Decision-model conformance cases ({mode}).",
        "metadata": {"mode": mode, "cases": len(results), "summary": summary(results)},
        "ensure_new": True,
    }
    if base_experiment_id:
        body["base_exp_id"] = base_experiment_id
    with httpx.Client(base_url=api_url, headers=headers, timeout=HTTP_TIMEOUT_SEC, transport=transport) as http:
        resp = http.post("/v1/experiment", json=body)
        if resp.status_code >= 400:
            raise RuntimeError(f"creating the experiment failed: HTTP {resp.status_code}")
        experiment = resp.json()
        exp_id = experiment["id"]
        events = [r.event() for r in results]
        for i in range(0, len(events), INSERT_BATCH):
            r = http.post(f"/v1/experiment/{exp_id}/insert", json={"events": events[i : i + INSERT_BATCH]})
            if r.status_code >= 400:
                raise RuntimeError(f"inserting experiment events failed: HTTP {r.status_code}")
    return experiment


# ---------------------------------------------------------------------- cli


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--live", action="store_true", help="ask the real decisions endpoint (needs OPENROUTER_API_KEY)")
    parser.add_argument("--dry-run", action="store_true", help="score only; upload nothing")
    parser.add_argument("--base-experiment-id", default=None, help="Braintrust experiment to compare with (e.g. main's)")
    parser.add_argument("--fail-under", type=float, default=None, help="exit 1 if the mean of the main score is below this (replay default 1.0)")
    args = parser.parse_args(argv)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    mode = "live" if args.live else "replay"
    if mode == "live" and not os.environ.get("OPENROUTER_API_KEY"):
        print("--live needs OPENROUTER_API_KEY", file=sys.stderr)
        return 2
    results = asyncio.run(run(mode, load_cases()))
    totals = summary(results)
    print(json.dumps({"mode": mode, "cases": len(results), "scores": totals}))

    cfg = None if args.dry_run else braintrust_config()
    if cfg is None:
        if not args.dry_run:
            print("BRAINTRUST_API_KEY / BRAINTRUST_PROJECT_ID not set: nothing uploaded")
    else:
        key, project, url = cfg
        try:
            exp = upload(results, mode=mode, key=key, project_id=project, api_url=url, base_experiment_id=args.base_experiment_id)
            print(json.dumps({"experiment_id": exp.get("id"), "name": exp.get("name")}))
        except Exception as e:  # noqa: BLE001 — observability never fails the check by itself
            print(f"upload failed: {e}", file=sys.stderr)

    main_score = "conformance" if mode == "replay" else "ok"
    floor = args.fail_under if args.fail_under is not None else (1.0 if mode == "replay" else None)
    if floor is not None and totals.get(main_score, 0.0) < floor:
        failed = [r.name for r in results if r.scores.get(main_score, 0.0) < 1.0]
        print(f"{main_score} below {floor}: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
