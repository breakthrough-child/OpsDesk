export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supa = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  return (
    <form action="/api/login" method="post" className="card mx-auto mt-10 max-w-sm space-y-3 p-6">
      <h1 className="text-lg font-semibold">Admin sign in</h1>
      <p className="text-xs text-stone-500">{supa ? 'Signs in with Supabase Auth.' : 'Local mode: enter the ADMIN_PASSWORD from your environment.'}</p>
      {supa && <input name="email" type="email" required placeholder="Email" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />}
      <input name="password" type="password" required placeholder="Password" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
      {error && <p className="text-sm text-red-700">{error === 'rate' ? 'Too many attempts. Try later.' : 'Wrong credentials.'}</p>}
      <button className="btn btn-primary w-full">Sign in</button>
    </form>
  );
}
