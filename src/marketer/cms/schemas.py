"""Wire models for the article CMS surface.

`Article` (marketer.articles.models) stays the pipeline's row model — it
describes generation. The CMS needs a view of the same row plus the
publication axis, so `CmsArticle` extends rather than replaces it; the two
are kept separate so the pipeline's schema is never forced to grow
editorial fields.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PublicationState(str, Enum):
    """Where the article sits relative to the public web.

    Orthogonal to `ArticleStatus`, which tracks the *generation* pipeline.
    A `done` article may be a draft; a `published` article may be re-run.
    """

    draft = "draft"
    scheduled = "scheduled"
    published = "published"


class RevisionSource(str, Enum):
    edit = "edit"
    restore = "restore"


#: The four fields a human may hand-edit, in the order they are shown.
#: Everything else on an article is pipeline output or bookkeeping and is
#: not user-writable through the CMS.
EDITABLE_FIELDS: tuple[str, ...] = (
    "title",
    "slug",
    "meta_description",
    "article_markdown",
)


class ArticleEdit(BaseModel):
    """PATCH body. Every field optional — an omitted field is untouched.

    `None` and "omitted" are the same thing here rather than "clear it":
    there is no sane meaning for clearing a title on an article that may be
    live, and PATCH semantics make omission the common case.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=300)
    slug: str | None = Field(default=None, max_length=200)
    meta_description: str | None = Field(default=None, max_length=500)
    article_markdown: str | None = Field(default=None, max_length=400_000)

    @field_validator("title", "slug", "meta_description")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() if v is not None else None

    def changes(self) -> dict[str, str]:
        """Only the fields the caller actually sent."""
        return {
            k: v
            for k, v in self.model_dump(exclude_unset=True).items()
            if v is not None and k in EDITABLE_FIELDS
        }


class CmsArticle(BaseModel):
    """An article as the CMS sees it: content + publication state."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    user_id: str
    niche_id: UUID
    #: Pipeline status ('queued'..'done'|'failed'), carried as a plain str
    #: so this model does not have to move when the enum grows.
    status: str
    publication_state: PublicationState = PublicationState.draft
    title: str | None = None
    slug: str | None = None
    meta_description: str | None = None
    article_markdown: str | None = None
    word_count: int | None = None
    published_at: datetime | None = None
    scheduled_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @property
    def has_content(self) -> bool:
        return bool((self.article_markdown or "").strip())


class RevisionSummary(BaseModel):
    """List-view row: what changed and when, without the content blob."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    article_id: UUID
    revision_number: int
    changed_fields: list[str] = Field(default_factory=list)
    summary: str = ""
    source: RevisionSource = RevisionSource.edit
    restored_from_revision_id: UUID | None = None
    created_at: datetime | None = None


class Revision(RevisionSummary):
    """One revision including the full snapshot of the prior content."""

    title: str | None = None
    slug: str | None = None
    meta_description: str | None = None
    article_markdown: str | None = None


class Collection(BaseModel):
    """A user-named grouping of articles (the source CMS's "blog group")."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    user_id: str
    name: str
    slug: str
    description: str = ""
    #: Populated by list/detail reads; absent (0) on a bare create response.
    article_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    #: Optional explicit slug; derived from `name` when omitted.
    slug: str | None = Field(default=None, max_length=200)


class CollectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    slug: str | None = Field(default=None, max_length=200)


class CollectionAssign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Bounded so one request cannot rewrite an unbounded membership set.
    article_ids: list[UUID] = Field(default_factory=list, max_length=500)


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Null (or omitted) publishes immediately; a future instant schedules.
    scheduled_at: datetime | None = None


class BulkTopics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    niche_id: UUID
    #: Bounded: each topic is a metered pipeline run, so an unbounded list
    #: is an unbounded spend request. 50 is a day's worth of publishing.
    topics: list[str] = Field(min_length=1, max_length=50)

    @field_validator("topics")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        cleaned = [t.strip()[:500] for t in v if t and t.strip()]
        if not cleaned:
            raise ValueError("topics must contain at least one non-empty entry")
        # Dedupe (order-preserving): queueing the same topic twice in one
        # request is always a paste mistake, and each dupe is real spend.
        seen: set[str] = set()
        out: list[str] = []
        for t in cleaned:
            key = t.casefold()
            if key not in seen:
                seen.add(key)
                out.append(t)
        return out


class BulkTopicsAccepted(BaseModel):
    queued: int
    article_ids: list[UUID] = Field(default_factory=list)
    #: Topics dropped as duplicates of another topic in the same request.
    skipped: list[str] = Field(default_factory=list)
