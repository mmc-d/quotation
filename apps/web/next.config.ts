import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** `next dev` only reads apps/web/.env*, so take DEV_ALLOWED_HOSTS from the repo-root .env when it isn't exported. */
function devAllowedHosts(): string {
  if (process.env.DEV_ALLOWED_HOSTS) return process.env.DEV_ALLOWED_HOSTS;
  try {
    return parseEnv(readFileSync(path.join(import.meta.dirname, '../../.env'), 'utf8')).DEV_ALLOWED_HOSTS ?? '';
  } catch {
    return '';
  }
}

/** The browser only talks to this origin; /api is proxied to the NestJS API (same-site cookies). */
const config: NextConfig = {
  reactStrictMode: true,
  // the "Compiling…" route badge of `next dev` confused testers; build / runtime errors still show
  devIndicators: false,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@mmc/domain'],
  // dev server reachable from other devices on the office network (this Mac serves as the test server)
  allowedDevOrigins: devAllowedHosts().split(',').map((h) => h.trim().toLowerCase()).filter(Boolean), // browsers send the host lower-cased
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
      ],
    }];
  },
};
export default config;
