import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/upload',
        destination: '/transactions',
        permanent: false,
      },
    ]
  },
};

export default nextConfig;
