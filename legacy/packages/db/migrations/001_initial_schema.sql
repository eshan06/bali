CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Schools (multi-school ready, 1 row for MVP)
CREATE TABLE schools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Teachers (linked to Cognito)
CREATE TABLE teachers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id),
    cognito_sub     VARCHAR(255) NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'teacher',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Classes
CREATE TABLE classes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   UUID NOT NULL REFERENCES schools(id),
    teacher_id  UUID NOT NULL REFERENCES teachers(id),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    period      VARCHAR(50),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Students (managed by teachers, no Cognito login)
CREATE TABLE students (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   UUID NOT NULL REFERENCES schools(id),
    first_name  VARCHAR(255) NOT NULL,
    last_name   VARCHAR(255) NOT NULL,
    email       VARCHAR(255),
    external_id VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Class enrollment (many-to-many)
CREATE TABLE class_students (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(class_id, student_id)
);

-- Hardware devices
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id),
    device_id       VARCHAR(255) NOT NULL UNIQUE,
    friendly_name   VARCHAR(255),
    student_id      UUID REFERENCES students(id),
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Class sessions
CREATE TABLE class_sessions (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id                        UUID NOT NULL REFERENCES classes(id),
    teacher_id                      UUID NOT NULL REFERENCES teachers(id),
    started_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at                        TIMESTAMPTZ,
    blocking_enabled                BOOLEAN NOT NULL DEFAULT FALSE,
    attendance_threshold_minutes    INTEGER NOT NULL DEFAULT 10,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw check-in events (immutable log)
CREATE TABLE check_ins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES class_sessions(id),
    device_id       VARCHAR(255) NOT NULL,
    student_id      UUID REFERENCES students(id),
    tap_timestamp   TIMESTAMPTZ NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, device_id, tap_timestamp)
);

-- Attendance records (one per student per session, mutable for overrides)
CREATE TABLE attendance_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES class_sessions(id),
    student_id      UUID NOT NULL REFERENCES students(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'absent',
    check_in_at     TIMESTAMPTZ,
    marked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    override_by     UUID REFERENCES teachers(id),
    UNIQUE(session_id, student_id)
);

-- Blocking apps catalog
CREATE TABLE blocking_apps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   UUID NOT NULL REFERENCES schools(id),
    bundle_id   VARCHAR(500) NOT NULL,
    app_name    VARCHAR(255) NOT NULL,
    category    VARCHAR(100),
    is_default  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-session blocklist overrides
CREATE TABLE session_blocklist (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES class_sessions(id),
    blocking_app_id UUID NOT NULL REFERENCES blocking_apps(id),
    UNIQUE(session_id, blocking_app_id)
);
