import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* The old Create Happ form used bg-white inputs, which were white-on-white in dark mode. */
const fieldBase =
  "w-full rounded-2xl border border-transparent bg-muted/70 px-4 text-[16px] text-foreground placeholder:text-muted-foreground/70 transition-colors duration-200 focus:border-ring/50 focus:bg-muted focus:outline-none disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(fieldBase, "h-12", invalid && "border-destructive/70 focus:border-destructive", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-[7rem] resize-none py-3 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  counter?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, htmlFor, hint, error, required, counter, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between px-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-accent">*</span>}
        </label>
        {counter && <span className="text-xs tabular-nums text-muted-foreground">{counter}</span>}
      </div>
      {children}
      {error ? (
        <p className="px-1 text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="px-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
