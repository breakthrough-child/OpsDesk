import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { config } from '@/lib/config';

// Runs before first paint so the saved theme (or the OS setting) is applied without a flash.
const THEME_SCRIPT = "try{var t=localStorage.getItem('opsdesk-theme')||'system';if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}";

export const metadata: Metadata = { title: 'OpsDesk', description: 'Customer-operations agent with approvals, evals and traces' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-screen font-sans antialiased">
        <Nav session={Boolean(session)} demo={config.demoMode} />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-stone-500">Fictional business &ldquo;Brightside Bakery &amp; Cafe Supplies&rdquo;. All data is synthetic. Outbound messages are simulated.</footer>
      </body>
    </html>
  );
}
