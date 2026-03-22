/** @type {import('next').NextConfig} */
const nextConfig = {
  // When NEXT_PUBLIC_API_URL is set (production / Vercel), the frontend calls
  // the Cloudflare Worker directly — no rewrites needed.
  //
  // When it is NOT set (local dev without a running worker), proxy /api/* to
  // the legacy FastAPI backend on localhost:8000 so local development still works.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_URL) {
      return [];
    }
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
