-- Phase 9A polish v2: add 'agent_unresolved' as a flag type so the
-- LLM-agent backfill script can flag hard-failure targets for human triage
-- via the existing /admin/review page.

ALTER TYPE flag_type ADD VALUE IF NOT EXISTS 'agent_unresolved';
