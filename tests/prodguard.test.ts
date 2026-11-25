import { describe, expect, it } from 'vitest';
import { assertProductionConfig, isStrongPassword, productionConfigProblems } from '../src/lib/prodGuard';

const good = { NODE_ENV: 'production', ADMIN_PASSWORD: 'k9#Vq2-xLp7wZr4T', MCP_TOKEN_SECRET: 'a'.repeat(8) + 'b3f1c9', WEBHOOK_SECRET: 'whsec_91f2c0aa77', ENCRYPTION_KEY: 'enc_5d83b7e1c4a9' };

describe('production start guard', () => {
  it('accepts a strong, complete configuration', () => {
    expect(productionConfigProblems(good)).toEqual([]);
    expect(() => assertProductionConfig(good)).not.toThrow();
  });
  it('refuses to start with a missing admin password', () => {
    expect(() => assertProductionConfig({ ...good, ADMIN_PASSWORD: undefined })).toThrow(/ADMIN_PASSWORD is missing/);
    expect(() => assertProductionConfig({ ...good, ADMIN_PASSWORD: '' })).toThrow(/missing/);
  });
  it('refuses "admin" in any case and other weak passwords', () => {
    expect(() => assertProductionConfig({ ...good, ADMIN_PASSWORD: 'admin' })).toThrow(/must not be "admin"/);
    expect(() => assertProductionConfig({ ...good, ADMIN_PASSWORD: 'ADMIN' })).toThrow(/must not be "admin"/);
    for (const p of ['short1!', 'password123', 'aaaaaaaaaaaaaaaa', 'changeme']) expect(isStrongPassword(p)).toBe(false);
    expect(() => assertProductionConfig({ ...good, ADMIN_PASSWORD: 'password123' })).toThrow(/too weak/);
  });
  it('refuses development default secrets and test-only switches', () => {
    expect(() => assertProductionConfig({ ...good, MCP_TOKEN_SECRET: 'dev-only-token-secret-change-me' })).toThrow(/MCP_TOKEN_SECRET/);
    expect(() => assertProductionConfig({ ...good, WEBHOOK_SECRET: undefined })).toThrow(/WEBHOOK_SECRET/);
    expect(() => assertProductionConfig({ ...good, FAULT_INJECTION: '1' })).toThrow(/FAULT_INJECTION/);
    expect(() => assertProductionConfig({ ...good, MOCK_GULLIBLE: '1' })).toThrow(/MOCK_GULLIBLE/);
  });
  it('does nothing outside production', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'development', ADMIN_PASSWORD: 'admin' })).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow();
  });
});
