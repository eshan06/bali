-- Per-class blocking configuration
-- blocking_preset: 'full_focus', 'no_social_media', 'no_games', 'custom', 'none'
ALTER TABLE classes
    ADD COLUMN blocking_preset VARCHAR(30) NOT NULL DEFAULT 'none',
    ADD COLUMN blocking_custom_app_ids UUID[] NOT NULL DEFAULT '{}';

-- Store custom blocked apps per class (for 'custom' preset)
CREATE TABLE class_blocked_apps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_app_id UUID NOT NULL REFERENCES teacher_apps(id) ON DELETE CASCADE,
    UNIQUE(class_id, teacher_app_id)
);
CREATE INDEX idx_class_blocked_apps_class ON class_blocked_apps(class_id);
