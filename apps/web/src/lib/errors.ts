import { ApiError, NetworkError } from './api-client';

/** A human-readable message for any thrown API/network error, safe to display. */
export function errText(e: unknown): string {
  if (e instanceof NetworkError) return e.message;
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
