import { Amplify } from 'aws-amplify';

export function configureCognito() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
        loginWith: {
          oauth: {
            domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '',
            scopes: ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
            redirectSignIn: [process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/auth/callback'],
            redirectSignOut: [process.env.NEXT_PUBLIC_REDIRECT_URI?.replace(/\/auth\/callback\/?$/, '') || 'http://localhost:3000'],
            responseType: 'code',
          },
        },
      },
    },
  });
}
