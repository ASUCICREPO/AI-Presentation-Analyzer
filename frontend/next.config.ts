import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  // Static export has no image optimization server — serve images as-is
  images: { unoptimized: true },
};

export default nextConfig;
