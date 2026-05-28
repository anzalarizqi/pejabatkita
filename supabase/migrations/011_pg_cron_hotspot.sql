-- supabase/migrations/011_pg_cron_hotspot.sql
-- Requires pg_cron and pg_net extensions (enable in Supabase dashboard first)
-- Schedule: 0 2 * * * UTC = 09:00 WIB
--
-- Before running this migration:
-- 1. Enable extensions in Supabase dashboard: Database → Extensions → pg_cron, pg_net
-- 2. Set DB-level GUCs (run in SQL editor once):
--      ALTER DATABASE postgres SET app.supabase_url     = 'https://<project>.supabase.co';
--      ALTER DATABASE postgres SET app.service_role_key = '<service-role-key>';

SELECT cron.schedule(
  'crawl-hotspot-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/crawl-hotspot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  )
  $$
);

-- Verify:
-- SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'crawl-hotspot-daily';
