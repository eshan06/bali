// Runs (as a vitest setupFile) BEFORE the test module imports anything from the app, so
// env.ts reads these values. SAFETY: the integration suite only ever touches the throwaway
// TEST_DATABASE_URL — never the real DATABASE_URL (RDS). Without TEST_DATABASE_URL the suite
// skips, and we never point the app at a non-test database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_TOKENS = '1';
process.env.COGNITO_USER_POOL_ID ||= 'us-east-1_test000000';
process.env.COGNITO_CLIENT_ID ||= 'testclient00000000';
process.env.DEFAULT_SCHOOL_ID ||= '11111111-1111-1111-1111-111111111111';
process.env.SEED_TEACHER_EMAIL ||= 'teacher@example.com';
