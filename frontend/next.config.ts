import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Static export for Amplify WEB (static) hosting — all routes are client-side
  output: "export",
};

export default nextConfig;
