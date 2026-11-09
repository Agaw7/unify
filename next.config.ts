
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  devIndicators: false,
  // Isolate each dev server from production builds and other local previews.
  distDir: phase === PHASE_DEVELOPMENT_SERVER
    ? `.next-dev-${process.env.PORT || '3000'}`
    : '.next',
});

export default nextConfig;
