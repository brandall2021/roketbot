/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: false },
  experimental: {
    serverComponentsExternalPackages: ["pdfkit"],
    outputFileTracingIncludes: {
      "/api/expedientes/export": ["./node_modules/pdfkit/js/data/**/*"],
    },
  },
};

export default nextConfig;
