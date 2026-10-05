'use client';
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    twoFactorClient({ onTwoFactorRedirect: () => { window.location.href = '/login?step=2fa'; } }),
    passkeyClient(),
  ],
});
