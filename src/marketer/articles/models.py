"""Pydantic models for the article pipeline.

Field names are camelCase where they feed structured-output prompts
(the models double as OpenAI response_format schemas); the DB row model
`Article` uses snake_case like the rest of marketer's schemas.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Research
# ---------------------------------------------------------------------------


class SerpResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    url: str
    domain: str
    wordCountEstimate: int | None = None
    highlights: list[str] = Field(default_factory=list)


class SerpAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topResults: list[SerpResult] = Field(default_factory=list)
    avgWordCount: int = 0
    commonHeadings: list[str] = Field(default_factory=list)
    commonTopics: list[str] = Field(default_factory=list)
    questionsAnswered: list[str] = Field(default_factory=list)
    recommendedWordCount: int = 1500
    topDomains: list[str] = Field(default_factory=list)


class ResearchOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    serp: SerpAnalysis
    gaps: list[str] = Field(default_factory=list)


class TopicPick(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic: str
    focusKeyword: str
    rationale: str = ""


class TopicProposalPick(BaseModel):
    """One candidate topic in a `propose_topics` batch — same shape as
    TopicPick plus a 0-1 confidence score, since proposals sit in an
    approval queue rather than being picked and run immediately."""

    model_config = ConfigDict(extra="ignore")

    title: str
    focusKeyword: str
    rationale: str = ""
    score: float = Field(default=0.5, ge=0.0, le=1.0)


class TopicProposalBatch(BaseModel):
    """Wrapper so `propose_topics` can request N proposals from a single
    structured-output call (OpenAI's parse() needs a top-level object)."""

    model_config = ConfigDict(extra="ignore")

    proposals: list[TopicProposalPick] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Outline
# ---------------------------------------------------------------------------


class OutlineSection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level: int
    heading: str
    notes: str = ""


class Outline(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    sections: list[OutlineSection]


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


class SectionContext(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    topic: str
    focusKeyword: str
    tone: str | None = None
    targetAudience: str | None = None
    outline: Outline
    research: SerpAnalysis | None = None
    previousSections: list[str] = Field(default_factory=list)
    revisionNotes: list[str] = Field(default_factory=list)


class InterlinkSuggestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    anchor: str
    targetUrl: str
    score: float


# ---------------------------------------------------------------------------
# Metadata / quality
# ---------------------------------------------------------------------------


class ArticleMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    slug: str
    metaDescription: str
    focusKeyword: str
    keywords: list[str] = Field(default_factory=list)


class QualityScore(BaseModel):
    model_config = ConfigDict(extra="ignore")

    overall: float
    keywordDensity: float
    eeatScore: float
    readability: float
    notes: list[str] = Field(default_factory=list)


class ImagePrompt(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    prompt: str
    altText: str


class SocialSnippet(BaseModel):
    model_config = ConfigDict(extra="ignore")

    platform: str  # 'twitter' | 'linkedin' | 'instagram' | 'facebook' | 'newsletter'
    body: str
    hashtags: list[str] = Field(default_factory=list)


class SocialSnippetSet(BaseModel):
    model_config = ConfigDict(extra="ignore")

    snippets: list[SocialSnippet] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------


class ArticlePublish(BaseModel):
    """One publish attempt (article_publishes row)."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    article_id: UUID
    target_id: UUID
    status: str = "pending"  # 'pending' | 'ok' | 'failed'
    external_url: str = ""
    error: str = ""
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# DB row model
# ---------------------------------------------------------------------------


class ArticleStatus(str, Enum):
    queued = "queued"
    researching = "researching"
    outlining = "outlining"
    writing = "writing"
    qa = "qa"
    metadata = "metadata"
    imaging = "imaging"
    done = "done"
    failed = "failed"


class Article(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    user_id: str
    niche_id: UUID
    status: ArticleStatus = ArticleStatus.queued
    topic: str = ""
    focus_keyword: str = ""
    title: str | None = None
    slug: str | None = None
    meta_description: str | None = None
    keywords: list[str] = Field(default_factory=list)
    article_markdown: str | None = None
    schema_jsonld: str | None = None
    hero_image_path: str | None = None
    hero_image_alt: str | None = None
    quality: QualityScore | None = None
    link_suggestions: list[InterlinkSuggestion] = Field(default_factory=list)
    word_count: int | None = None
    error: str | None = None
    # When set, the piece's intended publish date (autopilot cadence or a
    # manual schedule). Generation still happens at enqueue time; this is
    # when it should go out the door, not when it was written.
    scheduled_at: datetime | None = None
    # Cached SerpAnalysis.model_dump() from the research stage, so
    # GET /articles/{id}/research can serve it straight from the row.
    serp_analysis: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
