import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type TopBarProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  /** Where "back" goes when there's no history (e.g. opened from a link). */
  fallback?: string;
  onBack?: () => void;
  className?: string;
  transparent?: boolean;
};

export function useGoBack(fallback = "/map") {
  const navigate = useNavigate();
  return () => {
    // react-router stores its history index here; 0 means this is the first page.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

export function TopBar({ title, subtitle, right, fallback = "/map", onBack, className, transparent }: TopBarProps) {
  const goBack = useGoBack(fallback);
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center gap-2 px-3 pb-2 pt-safe",
        !transparent && "bg-background/85 backdrop-blur-xl",
        className,
      )}
    >
      <IconButton label="Back" variant="ghost" onClick={onBack ?? goBack}>
        <ChevronLeft className="h-6 w-6" />
      </IconButton>
      <div className="min-w-0 flex-1 text-center">
        {title && <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>}
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex min-w-11 items-center justify-end gap-1">{right}</div>
    </header>
  );
}
