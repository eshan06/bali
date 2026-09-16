/**
 * @bali/shared — types and constants shared between the API and its clients.
 * DTOs for each endpoint land here as the endpoints get built (Phase 1, step 7).
 */

/** URL version prefix. Additive-only once shipped; see docs/ARCHITECTURE.md "API surface". */
export const API_VERSION = 'v1';

/** Response shape of GET /healthz. */
export interface HealthzResponse {
  status: 'ok';
  version: string;
}
