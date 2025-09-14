import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true // TEMPORARILY DISABLE
  },
  typescript :{
    ignoreBuildErrors: true // TEMPORARILY ALLOW
  }
};

export default nextConfig;
