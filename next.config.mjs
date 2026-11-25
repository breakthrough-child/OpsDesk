/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  outputFileTracingIncludes: {
    '/**': ['./db/migrations/**', './data/docs/**', './evals/results/**/summary.json', './evals/retrieval/questions.json'],
  },
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
