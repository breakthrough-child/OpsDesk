import { mintToken, type Role } from '../mcp-server/auth';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
console.log(mintToken({ sub: arg('sub', 'cli-user')!, role: arg('role', 'viewer') as Role, cust: arg('cust'), ttlSec: Number(arg('ttl', '3600')) }));
