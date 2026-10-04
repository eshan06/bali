import { initMonitoring } from './lib/monitoring';

// Next runs this in the browser before the portal starts (Phase 5, P2). Without
// NEXT_PUBLIC_SENTRY_DSN at build time, monitoring stays off.
initMonitoring({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Vercel exposes the deployed commit to the build; unset elsewhere, no release is tagged.
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
});
