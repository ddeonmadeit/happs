import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar } from "@/components/ui/Avatar";
import { HappsMark, Wordmark } from "@/components/Logo";
import { cn } from "@/lib/utils";

/**
 * Home: the wordmark and the Happs mark. Tapping the mark fans out the three
 * main actions, like the original — minus the heavy embossed shadows, and
 * with a hint so first-time visitors know to tap.
 */
export default function Index() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontReady(true));
    const t = setTimeout(() => alive && setFontReady(true), 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  const actions = [
    {
      key: "find",
      label: "Find happs",
      icon: <MapPin className="h-5 w-5" />,
      onClick: () => navigate("/map"),
      offset: "translate-x-[76px] translate-y-[76px]",
      delay: "delay-[80ms]",
    },
    {
      key: "profile",
      label: user ? "Profile" : "Sign in",
      icon: null,
      onClick: () => navigate(user ? "/profile" : "/auth"),
      offset: "translate-y-[76px]",
      delay: "delay-[20ms]",
    },
    {
      key: "create",
      label: "Create a happ",
      icon: <Plus className="h-5 w-5" />,
      onClick: () => navigate("/create-happ"),
      offset: "-translate-x-[76px] translate-y-[76px]",
      delay: "delay-[80ms]",
    },
  ];

  return (
    <main className="relative flex h-dvh-screen flex-col items-center overflow-hidden bg-background px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[38%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl"
      />

      <div className="flex flex-1 flex-col items-center justify-end pb-16">
        <h1
          className={cn(
            "text-center text-[clamp(4rem,19vw,6.5rem)] text-accent transition-all duration-700 ease-smooth",
            fontReady ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          <Wordmark />
        </h1>
        <p
          className={cn(
            "mt-3 text-center text-[15px] text-muted-foreground transition-opacity delay-200 duration-700",
            fontReady ? "opacity-100" : "opacity-0",
          )}
        >
          See what’s happening around you, right now.
        </p>
      </div>

      <div className="relative flex flex-1 flex-col items-center">
        <div className="flex items-start justify-center gap-3">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              tabIndex={open ? 0 : -1}
              aria-hidden={!open}
              className={cn(
                "flex flex-col items-center gap-2 transition-all duration-500 ease-spring",
                open ? cn("translate-x-0 translate-y-0 scale-100 opacity-100", a.delay) : cn(a.offset, "pointer-events-none scale-50 opacity-0"),
              )}
            >
              <span
                className={cn(
                  "flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-accent/25 bg-card text-accent shadow-lg shadow-black/10 transition-transform duration-200 hover:scale-105 active:scale-95",
                )}
              >
                {a.key === "profile" ? (
                  <Avatar src={profile?.avatar_url} name={profile?.display_name || profile?.username} size="h-full w-full" className="bg-transparent text-accent" />
                ) : (
                  a.icon
                )}
              </span>
              <span className="w-24 text-center text-xs font-semibold uppercase tracking-wide text-foreground/80">{a.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className={cn(
            "mt-6 flex h-28 w-28 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-accent shadow-xl shadow-black/10 backdrop-blur-xl transition-all duration-500 ease-spring hover:bg-accent/20",
            open ? "rotate-45 scale-90" : "rotate-0 scale-100 hover:scale-105",
          )}
        >
          <HappsMark className="h-14 w-14" />
        </button>

        <p
          className={cn(
            "mt-5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition-opacity duration-300",
            open ? "opacity-0" : "opacity-100",
          )}
        >
          Tap to start
        </p>
      </div>
    </main>
  );
}
