import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'OpsDesk', description: 'Customer-operations agent with approvals, evals and traces' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Nav session={Boolean(session)} demo={config.demoMode} />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-stone-400">Fictional business &ldquo;Brightside Bakery &amp; Cafe Supplies&rdquo;. All data is synthetic. Outbound messages are simulated.</footer>
      </body>
    </html>
  );
}
