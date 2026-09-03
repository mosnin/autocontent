/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  // The OAuth 2.1 authorization server lives in the FastAPI app, which is
  // where the user table and the grant storage are. These rewrites keep its
  // public identity on marketer.sh, which matters for two reasons: the
  // issuer in the discovery documents has to be an origin a browser really
  // reaches, and the consent screen can only see Clerk's `__session` cookie
  // when the request is same-origin. Nothing is reimplemented here - the
  // request is forwarded verbatim, headers and all.
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!api) return [];
    return [
      { source: "/oauth/:path*", destination: `${api}/oauth/:path*` },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${api}/.well-known/oauth-authorization-server`,
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: `${api}/.well-known/oauth-protected-resource`,
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/company",
        destination: "/about",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
