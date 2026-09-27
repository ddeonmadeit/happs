import { Link, useLocation } from "react-router-dom";
import { HappsMark } from "@/components/Logo";

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-dvh-screen flex-col items-center justify-center gap-5 bg-background p-8 text-center">
      <HappsMark className="h-12 w-12 rotate-45 text-muted-foreground/50" />
      <div className="space-y-1">
        <p className="font-brunson text-6xl text-accent">404</p>
        <p className="font-medium">Nothing happening here</p>
        <p className="max-w-xs break-all text-sm text-muted-foreground">{pathname} doesn’t exist.</p>
      </div>
      <Link to="/" className="rounded-2xl bg-accent px-5 py-3 text-[15px] font-semibold text-accent-foreground transition-transform active:scale-95">
        Go home
      </Link>
    </div>
  );
}
