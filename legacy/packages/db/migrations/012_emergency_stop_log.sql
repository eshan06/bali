-- Durable log of student-initiated Emergency Stops. The device unlock is
-- immediate (no teacher approval); this records that it happened so the teacher
-- console can show it. Append-only — survives the student re-engaging (which
-- overwrites their device_blocking_status row).
CREATE TABLE IF NOT EXISTS emergency_stop_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES class_sessions(id),
    student_id  UUID NOT NULL REFERENCES students(id),
    reason      VARCHAR(60),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_stop_log_session ON emergency_stop_log(session_id);
