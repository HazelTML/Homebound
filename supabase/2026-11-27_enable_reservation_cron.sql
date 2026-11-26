-- OPTIONAL BUT RECOMMENDED for fully automatic start-date activation.
-- FIRST enable the pg_cron extension in Supabase Dashboard > Database > Extensions
-- (or Supabase Integrations > Cron, depending on dashboard version).
-- Run this SQL as the project database administrator AFTER the workflow migration.
-- Once per minute is used to avoid date-boundary timing surprises.
SELECT cron.schedule(
  'homebound-reservation-activate',
  '* * * * *',
  $$SELECT public.homebound_activate_due_reservations()$$
);
-- Verify: SELECT jobid, schedule, command FROM cron.job
--         WHERE jobname='homebound-reservation-activate';
-- To disable: SELECT cron.unschedule('homebound-reservation-activate');
