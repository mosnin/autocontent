-- Approval mode: niches can require operator sign-off before a rendered
-- video is scheduled to post. Existing niches keep the current fully
-- autonomous behavior (false); the onboarding wizard defaults new niches
-- to true so the trust ramp starts in review mode.
alter table niches add column approve_before_post boolean not null default false;

-- Jobs gated by approval park in this status after QA passes.
alter type job_status add value if not exists 'awaiting_approval';
