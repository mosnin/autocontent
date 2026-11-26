"""Tracker: the workspace's own tables (docs/tracker.md).

Permissions reuse the catalog (backend/policy.py, docs/auth/backend.md):

- reading tables, rows, history, members and the template list: ``content:read``
- adding and editing rows: ``content:update``; deleting a row: ``content:delete``
- creating a table (blank or from a template): ``playbook:create``
- changing a table's fields, views, name: ``playbook:update``; deleting a table: ``playbook:delete``
- logging an A/B test: ``content:update``, plus ``playbook:create`` when the log
  has to be created first (checked here)

Every query is scoped to ``ctx.user_id`` (the tenant). Nothing here moves money
or publishes, so no route goes through the rails.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from marketer.tracker import service as svc
from marketer.tracker.fields import FieldError
from marketer.tracker.templates import catalog

from .. import audit
from ..auth import AuthCtx, CurrentUser
from ..policy import require_permission

router = APIRouter()


def _actor(ctx: AuthCtx) -> svc.Actor:
    return svc.Actor(id=ctx.actor_id or None, type=audit.actor_type_of(ctx))


async def _run(coro: Any) -> Any:
    try:
        return await coro
    except svc.NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not found") from e
    except FieldError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    except svc.LimitReached as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(e)) from e


def _json_param(raw: str | None, what: str) -> Any:
    if raw is None or raw == "":
        return None
    try:
        return json.loads(raw)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{what} must be JSON") from e


# --------------------------------------------------------------------------- bodies


class TableCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class TableFromTemplate(BaseModel):
    template: str = Field(min_length=1, max_length=40)
    name: str | None = Field(default=None, max_length=120)


class TablePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class FieldCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: str = Field(max_length=20)
    options: dict[str, Any] = Field(default_factory=dict)


class FieldPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    type: str | None = Field(default=None, max_length=20)
    options: dict[str, Any] | None = None
    position: int | None = Field(default=None, ge=0, le=10_000)


class ViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: Literal["grid", "board", "calendar", "gallery"]
    config: dict[str, Any] = Field(default_factory=dict)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    filter_type: Literal["and", "or"] = "and"
    sorts: list[dict[str, Any]] = Field(default_factory=list)
    hidden_fields: list[str] = Field(default_factory=list)


class ViewPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    config: dict[str, Any] | None = None
    filters: list[dict[str, Any]] | None = None
    filter_type: Literal["and", "or"] | None = None
    sorts: list[dict[str, Any]] | None = None
    hidden_fields: list[str] | None = None
    position: int | None = Field(default=None, ge=0, le=10_000)


class RowCreate(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict, description="field id or field name → value")
    before_id: str | None = None


class RowPatch(BaseModel):
    values: dict[str, Any]


class RowMove(BaseModel):
    before_id: str | None = None


class AbTestLog(BaseModel):
    values: dict[str, Any] = Field(description="field name (or id) → value, e.g. Test, Hypothesis, Variant A, Metric")


# --------------------------------------------------------------------------- catalog


@router.get("/templates")
async def list_templates(ctx: AuthCtx = CurrentUser) -> list[dict[str, Any]]:
    return catalog()


@router.get("/members")
async def list_members(ctx: AuthCtx = CurrentUser) -> list[dict[str, str]]:
    people = await svc.members(ctx.user_id)
    # The agent sees who is who, not their addresses.
    return [{"id": p["id"], "name": p["name"]} for p in people] if ctx.delegated else people


@router.get("/objects")
async def search_objects(
    request: Request,
    kind: str = Query(max_length=20),
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
    ctx: AuthCtx = CurrentUser,
) -> list[dict[str, Any]]:
    if kind == "campaign":
        await require_permission(ctx, "campaign:read", request=request)
    return await _run(svc.search_objects(ctx.user_id, kind, q, limit))


# --------------------------------------------------------------------------- tables


@router.get("/tables")
async def list_tables(ctx: AuthCtx = CurrentUser) -> list[dict[str, Any]]:
    return await svc.list_tables(ctx.user_id)


@router.post("/tables", status_code=status.HTTP_201_CREATED)
async def create_table(body: TableCreate, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    t = await _run(svc.create_table(ctx.user_id, _actor(ctx), name=body.name, description=body.description))
    return await _run(svc.get_table(ctx.user_id, t["id"]))


@router.post("/tables/from-template", status_code=status.HTTP_201_CREATED)
async def create_from_template(body: TableFromTemplate, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.create_from_template(ctx.user_id, _actor(ctx), body.template, name=body.name))


@router.get("/tables/{table_id}")
async def get_table(table_id: str, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.get_table(ctx.user_id, table_id))


@router.patch("/tables/{table_id}")
async def update_table(table_id: str, body: TablePatch, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.update_table(ctx.user_id, table_id, name=body.name, description=body.description))


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_table(table_id: str, ctx: AuthCtx = CurrentUser) -> None:
    t = await _run(svc.delete_table(ctx.user_id, table_id))
    await audit.record(ctx, "tracker.table_deleted", outcome="success", target_type="tracker_table", target_id=t["id"])


# --------------------------------------------------------------------------- fields


@router.post("/tables/{table_id}/fields", status_code=status.HTTP_201_CREATED)
async def create_field(table_id: str, body: FieldCreate, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.create_field(ctx.user_id, table_id, name=body.name, type=body.type, options=body.options))


@router.patch("/tables/{table_id}/fields/{field_id}")
async def update_field(table_id: str, field_id: str, body: FieldPatch, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(
        svc.update_field(ctx.user_id, table_id, field_id, name=body.name, type=body.type, options=body.options, position=body.position)
    )


@router.delete("/tables/{table_id}/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(table_id: str, field_id: str, ctx: AuthCtx = CurrentUser) -> None:
    f = await _run(svc.delete_field(ctx.user_id, table_id, field_id))
    await audit.record(
        ctx, "tracker.field_deleted", outcome="success", target_type="tracker_field", target_id=f["id"],
        metadata={"table_id": table_id, "type": f["type"]},
    )


# --------------------------------------------------------------------------- views


@router.post("/tables/{table_id}/views", status_code=status.HTTP_201_CREATED)
async def create_view(table_id: str, body: ViewCreate, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(
        svc.create_view(
            ctx.user_id, table_id, name=body.name, type=body.type, config=body.config, filters=body.filters,
            filter_type=body.filter_type, sorts=body.sorts, hidden_fields=body.hidden_fields,
        )
    )


@router.patch("/tables/{table_id}/views/{view_id}")
async def update_view(table_id: str, view_id: str, body: ViewPatch, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.update_view(ctx.user_id, table_id, view_id, body.model_dump(exclude_unset=True)))


@router.delete("/tables/{table_id}/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_view(table_id: str, view_id: str, ctx: AuthCtx = CurrentUser) -> None:
    await _run(svc.delete_view(ctx.user_id, table_id, view_id))


# --------------------------------------------------------------------------- rows


@router.get("/tables/{table_id}/rows")
async def list_rows(
    table_id: str,
    view_id: str | None = Query(default=None, max_length=40),
    filters: str | None = Query(default=None, max_length=8000, description="JSON list of {field_id, op, value}"),
    filter_type: Literal["and", "or"] | None = None,
    sorts: str | None = Query(default=None, max_length=2000, description="JSON list of {field_id, direction}"),
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=100, ge=1, le=svc.MAX_PAGE),
    offset: int = Query(default=0, ge=0, le=svc.MAX_ROWS),
    ctx: AuthCtx = CurrentUser,
) -> dict[str, Any]:
    return await _run(
        svc.list_rows(
            ctx.user_id, table_id, view_id=view_id, filters=_json_param(filters, "filters"), filter_type=filter_type,
            sorts=_json_param(sorts, "sorts"), search=q, limit=limit, offset=offset,
            can_read_campaigns=ctx.can("campaign:read"),
        )
    )


@router.post("/tables/{table_id}/rows", status_code=status.HTTP_201_CREATED)
async def create_row(table_id: str, body: RowCreate, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.create_row(ctx.user_id, table_id, body.values, _actor(ctx), before_id=body.before_id))


@router.get("/tables/{table_id}/rows/{row_id}")
async def get_row(table_id: str, row_id: str, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.get_row(ctx.user_id, table_id, row_id, can_read_campaigns=ctx.can("campaign:read")))


@router.patch("/tables/{table_id}/rows/{row_id}")
async def update_row(table_id: str, row_id: str, body: RowPatch, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.update_row(ctx.user_id, table_id, row_id, body.values, _actor(ctx)))


@router.post("/tables/{table_id}/rows/{row_id}/move")
async def move_row(table_id: str, row_id: str, body: RowMove, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    return await _run(svc.move_row(ctx.user_id, table_id, row_id, before_id=body.before_id))


@router.delete("/tables/{table_id}/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_row(table_id: str, row_id: str, ctx: AuthCtx = CurrentUser) -> None:
    await _run(svc.delete_row(ctx.user_id, table_id, row_id, _actor(ctx)))


@router.get("/tables/{table_id}/rows/{row_id}/history")
async def row_history(table_id: str, row_id: str, ctx: AuthCtx = CurrentUser) -> list[dict[str, Any]]:
    return await _run(svc.row_history(ctx.user_id, table_id, row_id))


# --------------------------------------------------------------------------- A/B tests


@router.post("/ab-tests", status_code=status.HTTP_201_CREATED)
async def log_ab_test(request: Request, body: AbTestLog, ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    may_create = ctx.can("playbook:create")
    if not may_create and await svc.ab_test_table(ctx.user_id) is None:
        await require_permission(ctx, "playbook:create", request=request)
    return await _run(svc.log_ab_test(ctx.user_id, _actor(ctx), body.values, may_create_table=may_create))
