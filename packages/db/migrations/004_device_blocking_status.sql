-- Per-student device blocking status during a session
-- Tracks whether the student's device has confirmed blocking is active
CREATE TABLE device_blocking_status (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES class_sessions(id),
    student_id  UUID NOT NULL REFERENCES students(id),
    is_blocked  BOOLEAN NOT NULL DEFAULT FALSE,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reported_by VARCHAR(20) NOT NULL DEFAULT 'manual',  -- 'manual' (teacher) or 'device' (iOS app)
    UNIQUE(session_id, student_id)
);

CREATE INDEX idx_device_blocking_status_session ON device_blocking_status(session_id);
