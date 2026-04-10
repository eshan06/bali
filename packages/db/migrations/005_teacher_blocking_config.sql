-- Per-teacher app catalog
CREATE TABLE teacher_apps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id  UUID NOT NULL REFERENCES teachers(id),
    bundle_id   VARCHAR(500) NOT NULL,
    app_name    VARCHAR(255) NOT NULL,
    category    VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(teacher_id, bundle_id)
);
CREATE INDEX idx_teacher_apps_teacher ON teacher_apps(teacher_id);

-- Teacher's saved default blocking config
CREATE TABLE teacher_blocking_defaults (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id      UUID NOT NULL REFERENCES teachers(id) UNIQUE,
    blocking_mode   VARCHAR(20) NOT NULL DEFAULT 'block_specific',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teacher_blocking_default_apps (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    default_config_id   UUID NOT NULL REFERENCES teacher_blocking_defaults(id) ON DELETE CASCADE,
    teacher_app_id      UUID NOT NULL REFERENCES teacher_apps(id) ON DELETE CASCADE,
    UNIQUE(default_config_id, teacher_app_id)
);

-- Add blocking mode to sessions
ALTER TABLE class_sessions
    ADD COLUMN blocking_mode VARCHAR(20) NOT NULL DEFAULT 'block_specific';

-- Per-session blocking app selection (references teacher_apps)
CREATE TABLE session_blocking_apps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    teacher_app_id  UUID NOT NULL REFERENCES teacher_apps(id) ON DELETE CASCADE,
    UNIQUE(session_id, teacher_app_id)
);
CREATE INDEX idx_session_blocking_apps_session ON session_blocking_apps(session_id);
