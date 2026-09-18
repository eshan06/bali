import { describe, expect, it } from 'vitest';

import { base64UrlEncode, codeChallengeFor, createCodeVerifier, createState } from './pkce';

describe('pkce', () => {
  it('computes the RFC 7636 S256 challenge for the reference verifier', async () => {
    // RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await codeChallengeFor(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates a 43-char base64url verifier from 32 bytes', () => {
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCodeVerifier()).not.toBe(v); // random
  });

  it('base64url-encodes without padding or +/ characters', () => {
    expect(base64UrlEncode(new Uint8Array([255, 255, 255]))).toBe('____');
    expect(base64UrlEncode(new Uint8Array([0]))).toBe('AA');
  });

  it('creates a non-empty base64url state', () => {
    expect(createState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
