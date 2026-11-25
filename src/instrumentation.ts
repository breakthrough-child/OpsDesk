/** Runs once when the Next.js server starts. In production, an unsafe configuration stops the server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    const { assertProductionConfig } = await import('./lib/prodGuard');
    assertProductionConfig();
  }
}
