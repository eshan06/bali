-- Each session captures an immutable snapshot of the blocking policy at
-- start time so iOS/simulator clients can read the policy without
-- re-resolving from the class config (which may change mid-session).
-- Shape: { preset, mode, blockingActive, blockedApps:[{bundleId,appName}], allowedApps:[...] }
ALTER TABLE class_sessions
    ADD COLUMN blocking_config_snapshot JSONB;

-- Default attendance threshold goes from 10 → 5 minutes (auto-mark `late`
-- after 5 min of session start). Existing sessions retain their stored value.
ALTER TABLE class_sessions
    ALTER COLUMN attendance_threshold_minutes SET DEFAULT 5;
