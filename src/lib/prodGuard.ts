const DEV_DEFAULTS: Record<string, string> = {
  MCP_TOKEN_SECRET: 'dev-only-token-secret-change-me',
  WEBHOOK_SECRET: 'dev-only-webhook-secret',
  ENCRYPTION_KEY: 'dev-only-encryption-key-change-me',
};
const WEAK = new Set(['admin', 'password', 'changeme', 'change-me', 'letmein', 'opsdesk', 'admin123', 'password123', '123456789012']);

export function isStrongPassword(p: string | undefined): boolean {
  if (!p || p.length < 12) return false;
  if (WEAK.has(p.toLowerCase())) return false;
  return new Set(p).size >= 6;
}

/** Problems that make a production start unsafe. Empty array = OK. Pure so it can be unit-tested. */
export function productionConfigProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (!env.ADMIN_PASSWORD) problems.push('ADMIN_PASSWORD is missing');
  else if (env.ADMIN_PASSWORD.toLowerCase() === 'admin') problems.push('ADMIN_PASSWORD must not be "admin"');
  else if (!isStrongPassword(env.ADMIN_PASSWORD)) problems.push('ADMIN_PASSWORD is too weak (use at least 12 characters, with at least 6 distinct)');
  for (const [k, dev] of Object.entries(DEV_DEFAULTS)) {
    if (!env[k] || env[k] === dev) problems.push(`${k} is missing or still the development default`);
  }
  if (env.FAULT_INJECTION === '1') problems.push('FAULT_INJECTION must not be enabled in production');
  if (env.MOCK_GULLIBLE === '1') problems.push('MOCK_GULLIBLE must not be enabled in production');
  return problems;
}

/** Throws (so the server refuses to start) when running in production with an unsafe configuration. */
export function assertProductionConfig(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems = productionConfigProblems(env);
  if (problems.length) throw new Error(`Refusing to start in production:\n - ${problems.join('\n - ')}\nSee .env.example.`);
}
