import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained: deployment bundle is rooted at interface/.
  outputFileTracingRoot: __dirname,
  // postgres-js is a Node-only package; keep it external to the server bundle.
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
