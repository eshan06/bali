-- In-app invites: a teacher invites a student by email; the invite shows up
-- on the student's portal until they accept or the teacher revokes it.
-- Independent of class_students — accepting an invite creates the enrollment.
CREATE TABLE class_invites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    email        VARCHAR(255) NOT NULL,
    invited_by   UUID NOT NULL REFERENCES teachers(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at  TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

-- Only one pending invite per (class, email). Revoked/accepted invites can
-- coexist with a fresh re-invite, so we partial-unique on the active ones.
CREATE UNIQUE INDEX idx_class_invites_active_unique
    ON class_invites (class_id, LOWER(email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_class_invites_email_active
    ON class_invites (LOWER(email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_class_invites_class ON class_invites (class_id);
