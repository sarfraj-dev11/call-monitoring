import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*"],
  compress: true,
  productionBrowserSourceMaps: false,
  experimental: {
    cpus: 2,
    optimizePackageImports: ["lucide-react"],
    serverActions: {
      bodySizeLimit: "100mb"
    }
  }
};

export default nextConfig;
