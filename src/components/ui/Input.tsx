import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-2xl border-2 border-transparent bg-muted px-4 text-[16px] text-foreground placeholder:text-muted-foreground/70 transition-[border-color,background-color] duration-200 focus:border-accent/70 focus:outline-none disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(fieldBase, "h-[52px]", invalid && "border-destructive/70 focus:border-destructive", className)}
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
        <label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
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
