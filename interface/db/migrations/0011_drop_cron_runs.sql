-- Drop the cron_runs table. We no longer persist per-invocation cron history:
--   - Vercel's function logs already capture the per-invocation summary (logged in wrapCron).
--   - Failures fan out to Slack/Telegram via notifyError, independent of any DB row.
--   - Nothing in the app ever read this table — it was purely append-only and was growing
--     unbounded across ~30 crons each running every minute.
DROP TABLE IF EXISTS "cron_runs";
