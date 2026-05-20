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
        destination: '/office/goals',
        permanent: true,
      },
      {
        source: '/trips',
        destination: '/office/goals/travel-events',
        permanent: true,
      },
      {
        source: '/profile',
        destination: '/office/values/portrait',
        permanent: true,
      },
      {
        source: '/chat/:id',
        destination: '/office',
        permanent: true,
      },
      {
        source: '/balance-sheet',
        destination: '/office/net-worth/balance-sheet',
        permanent: true,
      },
      {
        source: '/goals',
        destination: '/office/goals',
        permanent: true,
      },
      // v2.5 IA simplification: Scenarios folder dropped, Goals folder expanded.
      // Old /office/scenarios/* URLs land on the new /office/goals/* surface.
      {
        source: '/office/scenarios',
        destination: '/office/goals',
        permanent: true,
      },
      {
        source: '/office/scenarios/what-if',
        destination: '/office/goals',
        permanent: true,
      },
      {
        source: '/office/scenarios/goals',
        destination: '/office/goals',
        permanent: true,
      },
      {
        source: '/office/scenarios/goals/:path*',
        destination: '/office/goals/:path*',
        permanent: true,
      },
      {
        source: '/office/scenarios/trips',
        destination: '/office/goals/travel-events',
        permanent: true,
      },
      {
        source: '/office/scenarios/trips/:path*',
        destination: '/office/goals/travel-events/:path*',
        permanent: true,
      },
      {
        source: '/settings',
        destination: '/office/settings',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
