import { useNavigate } from "react-router-dom";
import { Check, Download, LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { COLOR_SCHEMES, useTheme } from "@/contexts/ThemeContext";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { PushToggle } from "@/components/PushControls";
import { cn } from "@/lib/utils";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { colorScheme, mode, setColorScheme, setMode } = useTheme();
  const { isInstalled } = useInstallPrompt();

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Theme</h3>
          <div className="grid grid-cols-3 gap-2">
            {COLOR_SCHEMES.map((scheme) => {
              const selected = colorScheme === scheme.id;
              return (
                <button
                  key={scheme.id}
                  type="button"
                  onClick={() => setColorScheme(scheme.id)}
                  aria-pressed={selected}
                  className={cn(
                    "relative flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-all duration-200",
                    selected ? "border-accent bg-accent/5" : "border-border hover:border-muted-foreground/40",
                  )}
                >
                  <span className="flex h-9 overflow-hidden rounded-lg shadow-sm">
                    <span className="w-5" style={{ backgroundColor: scheme.light }} />
                    <span className="w-5" style={{ backgroundColor: scheme.highlight }} />
                    <span className="w-5" style={{ backgroundColor: scheme.dark }} />
                  </span>
                  <span className="text-xs font-medium">{scheme.label}</span>
                  {selected && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              {mode === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </span>
            <span className="flex-1 text-[15px] font-medium">Dark mode</span>
            <Switch label="Dark mode" checked={mode === "dark"} onCheckedChange={(on) => setMode(on ? "dark" : "light")} />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notifications</h3>
          <div className="rounded-2xl bg-muted/50 p-3">
            <PushToggle />
          </div>
        </section>

        <div className="space-y-2 pt-1">
          {!isInstalled && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                onClose();
                navigate("/install");
              }}
            >
              <Download className="h-4 w-4" /> Install the app
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full text-destructive hover:bg-destructive/10"
            onClick={async () => {
              onClose();
              await signOut();
              navigate("/", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
