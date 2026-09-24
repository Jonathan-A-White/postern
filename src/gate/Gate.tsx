export function Gate() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-900 text-slate-200">
      <h1 className="text-3xl font-semibold">Postern</h1>
      <p className="text-xl">The gate is locked</p>
      <p className="text-sm text-slate-400">v{__APP_VERSION__}</p>
    </main>
  );
}
