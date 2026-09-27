import { HappsMark, Wordmark } from "@/components/Logo";

/** Shown instead of a blank crash when the Supabase env vars are missing. */
export default function SetupRequired() {
  return (
    <div className="scroll-area absolute inset-0 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <HappsMark className="mx-auto h-14 w-14 text-accent" />
        <Wordmark className="block text-5xl text-accent" />
        <div className="space-y-3 rounded-4xl bg-card p-6 text-left">
          <h1 className="text-lg font-semibold">Connect a Supabase project</h1>
          <p className="text-sm text-muted-foreground">
            Copy <code className="rounded bg-muted px-1.5 py-0.5">.env.example</code> to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">.env</code> and fill in your project URL and publishable
            key, then restart the dev server. See the README for the full backend setup.
          </p>
          <pre className="overflow-x-auto rounded-2xl bg-muted p-4 text-xs leading-relaxed">
            {`VITE_SUPABASE_URL=https://xxxx.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=...`}
          </pre>
        </div>
      </div>
    </div>
  );
}
