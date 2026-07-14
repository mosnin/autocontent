create table post_metrics (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users(id) on delete cascade,
    job_id uuid not null references jobs(id) on delete cascade,
    provider_post_id text not null,
    platform text not null,         -- 'tiktok' | 'reels' | 'shorts'
    sampled_at timestamptz not null default now(),
    -- raw engagement metrics from Ayrshare. Different platforms expose
    -- different fields; we store the superset and let downstream
    -- attribution decide what's meaningful.
    views bigint,
    likes bigint,
    comments bigint,
    shares bigint,
    saves bigint,
    watch_time_sec numeric(12, 2),
    avg_watch_time_sec numeric(8, 2),
    completion_rate numeric(5, 4),  -- 0..1
    reach bigint,
    impressions bigint,
    raw jsonb not null,             -- full Ayrshare response for forensics
    created_at timestamptz not null default now()
);

create index post_metrics_job_idx on post_metrics(job_id, sampled_at desc);
create index post_metrics_user_sampled_idx on post_metrics(user_id, sampled_at desc);
create index post_metrics_provider_idx on post_metrics(provider_post_id);
