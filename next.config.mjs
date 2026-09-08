/** @type {import('next').NextConfig} */
const cdnHost = process.env.NEXT_PUBLIC_CDN_URL
  ? new URL(process.env.NEXT_PUBLIC_CDN_URL).hostname
  : undefined;

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: {
    // Thumbs/display are already resized in the browser before upload, so we
    // serve them straight from the CDN without Next's optimizer.
    unoptimized: true,
    remotePatterns: cdnHost
      ? [{ protocol: "https", hostname: cdnHost }]
      : [{ protocol: "https", hostname: "**" }],
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
