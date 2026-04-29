import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure the parent tenderly/src tree is bundled into Vercel's function output.
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  // postgres-js is a Node-only package; keep it external to the server bundle.
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
