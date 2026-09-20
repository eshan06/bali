/**
 * Public runtime config, read from NEXT_PUBLIC_* env (baked at build time and
 * safe to expose — no secrets: the PKCE flow uses a public client). The API base
 * URL and Cognito hosted-UI details are set per environment; the defaults point
 * at a local dev setup.
 */
export interface WebConfig {
  apiUrl: string;
  cognito: {
    /** Hosted-UI domain, e.g. https://bali-dev.auth.us-east-1.amazoncognito.com */
    domain: string;
    clientId: string;
    /** Must match a callback URL registered on the Cognito app client. */
    redirectUri: string;
    /** Space-separated OAuth scopes. */
    scopes: string;
  };
}

export const config: WebConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  cognito: {
    domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '',
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
    redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',
    scopes: process.env.NEXT_PUBLIC_COGNITO_SCOPES ?? 'openid email profile',
  },
};
