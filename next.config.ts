import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle CSV files for serverless deployments (Vercel etc.)
  outputFileTracingIncludes: {
    "**": ["./data/**/*"],
  },
};

export default nextConfig;
