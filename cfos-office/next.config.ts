import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/upload',
        destination: '/office/cash-flow/transactions',
        permanent: false,
      },
      {
        source: '/dashboard',
        destination: '/office',
        permanent: true,
      },
      {
        source: '/chat',
        destination: '/office',
        permanent: true,
      },
      {
        source: '/bills',
        destination: '/office/cash-flow/bills',
        permanent: true,
      },
      {
        source: '/transactions',
        destination: '/office/cash-flow/transactions',
        permanent: true,
      },
      {
        source: '/scenarios',
        destination: '/office/scenarios/what-if',
        permanent: true,
      },
      {
        source: '/trips',
        destination: '/office/scenarios/trips',
        permanent: true,
      },
      {
        source: '/profile',
        destination: '/office/values/portrait',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
