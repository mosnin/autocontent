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
    created_at: datetime | None = None
    updated_at: datetime | None = None
