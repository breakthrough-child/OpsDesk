import { BUSINESS_NOW } from '../../data/seed';

const env = (k: string, d = '') => process.env[k] ?? d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

export type ChunkerKind = 'fixed' | 'structure';
export type SearchMode = 'keyword' | 'hybrid';
export type RerankKind = 'none' | 'heuristic' | 'llm';

/** Read lazily so tests can mutate process.env. */
export const config = {
  get provider(): 'anthropic' | 'mock' {
    const p = env('LLM_PROVIDER');
    if (p === 'mock' || p === 'anthropic') return p;
    return env('ANTHROPIC_API_KEY') ? 'anthropic' : 'mock';
  },
  get agentModel() { return env('AGENT_MODEL', 'claude-sonnet-5-5'); },
  get classifierModel() { return env('CLASSIFIER_MODEL', 'claude-haiku-5-5'); },
  get judgeModel() { return env('JUDGE_MODEL', env('AGENT_MODEL', 'claude-sonnet-5-5')); },
  get now() { return new Date(env('BUSINESS_NOW', BUSINESS_NOW)); },
  get approvalValueThreshold() { return num('APPROVAL_VALUE_THRESHOLD', 50); },
  get maxAgentSteps() { return num('MAX_AGENT_STEPS', 8); },
  get maxTokensPerRequest() { return num('MAX_TOKENS_PER_REQUEST', 40000); },
  get retrieval() {
    return {
      chunker: env('RETRIEVAL_CHUNKER', 'structure') as ChunkerKind,
      mode: env('RETRIEVAL_MODE', 'hybrid') as SearchMode,
      rerank: env('RETRIEVAL_RERANK', 'heuristic') as RerankKind,
      topK: num('RETRIEVAL_TOP_K', 4),
      minScore: num('RETRIEVAL_MIN_SCORE', 0.1),
    };
  },
  get embeddingsKey() { return env('EMBEDDINGS_API_KEY'); },
  get tokenSecret() { return env('MCP_TOKEN_SECRET', 'dev-only-token-secret-change-me'); },
  get webhookSecret() { return env('WEBHOOK_SECRET', 'dev-only-webhook-secret'); },
  get encryptionKey() { return env('ENCRYPTION_KEY', 'dev-only-encryption-key-change-me'); },
  get adminPassword() { return env('ADMIN_PASSWORD', 'admin'); },
  get demoMode() { return env('DEMO_MODE') === '1'; },
  get demoDailyCostCapUsd() { return num('DEMO_DAILY_COST_CAP_USD', 2); },
  get demoRateLimitPerHour() { return num('DEMO_RATE_LIMIT_PER_HOUR', 20); },
  get faultInjection() { return env('FAULT_INJECTION') === '1' || env('NODE_ENV') === 'test'; },
  get slackWebhook() { return env('SLACK_WEBHOOK_URL'); },
  get google() {
    return { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET'), calendarId: env('GOOGLE_CALENDAR_ID', 'primary'), redirect: env('GOOGLE_REDIRECT_URI', 'http://localhost:3000/api/oauth/google/callback') };
  },
  get databaseUrl() { return env('DATABASE_URL'); },
  get pgliteDir() { return env('PGLITE_DIR', '.data/pglite'); },
};
