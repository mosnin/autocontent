-- Additive production records. Existing generation and publishing own their states.
CREATE TABLE production_packages (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creative_kind text NOT NULL,
    creative_id uuid NOT NULL,
    version integer NOT NULL DEFAULT 0,
    brief_version integer NOT NULL DEFAULT 0,
    state jsonb NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, creative_kind, creative_id)
);
CREATE TABLE production_events (
    user_id text NOT NULL,
    creative_kind text NOT NULL,
    creative_id uuid NOT NULL,
    version integer NOT NULL,
    action text NOT NULL,
    source_fingerprint text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, creative_kind, creative_id, version),
    FOREIGN KEY (user_id, creative_kind, creative_id)
        REFERENCES production_packages ON DELETE CASCADE
);

-- Assets may be overwritten at a stable path. Every registration advances review identity.
ALTER TABLE media_assets ADD COLUMN revision bigint NOT NULL DEFAULT 1;
