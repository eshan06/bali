-- Allow students to create their own account linked to Cognito.
-- school_id becomes nullable: a self-signed-up student has no school until they
-- accept their first class invite, at which point school_id is set from the class.
ALTER TABLE students ALTER COLUMN school_id DROP NOT NULL;

ALTER TABLE students ADD COLUMN cognito_sub VARCHAR(255) UNIQUE;
ALTER TABLE students ADD COLUMN grade VARCHAR(50);

CREATE INDEX idx_students_cognito_sub ON students(cognito_sub) WHERE cognito_sub IS NOT NULL;
