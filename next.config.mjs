/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['bcryptjs', 'nodemailer', 'pg'],
  /**
   * Baseline headers for every response.
   *
   * `middleware.ts` sets a richer set — including the nonce-based CSP — but its
   * matcher deliberately skips `/api/*` and static assets. These are the floor
   * that applies everywhere, so an API response can never come back without
   * them.
   */
  async headers() {
    const baseline = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      },
      // A JSON endpoint should never be interpreted as a document, so lock it
      // down completely; the page CSP from middleware is what the app runs on.
      { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
    ];

    if (process.env.NODE_ENV === 'production') {
      baseline.push({
        // Two years, so the browser refuses plain HTTP for this host outright.
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    return [
      { source: '/api/:path*', headers: baseline },
      {
        source: '/(.*)',
        // Same list minus the CSP: pages get their nonce-based policy from
        // middleware, and a second CSP header would intersect with it and break
        // script execution.
        headers: baseline.filter((h) => h.key !== 'Content-Security-Policy'),
      },
    ];
  },
};

export default nextConfig;
