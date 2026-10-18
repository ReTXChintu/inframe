import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router";
import { ChevronDown, Eye, EyeOff, Loader2, X } from "lucide-react";
import { initials } from "@/lib/format";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ─── Buttons ─────────────────────────────────────────────────────────────
type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink-2",
  accent: "bg-accent text-accent-ink hover:brightness-105",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-105",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background,filter,opacity] select-none disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/** A router link that looks like a Button (avoids nesting <button> inside <a>). */
export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: Omit<LinkProps, "className"> & { variant?: Variant; size?: Size; icon?: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background,filter] select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  className,
  children,
  variant = "ghost",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: "ghost" | "secondary" | "glass" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
        variant === "ghost" && "text-ink hover:bg-surface-2",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "glass" && "bg-white/10 text-white backdrop-blur hover:bg-white/20",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cx("size-5 animate-spin text-muted", className)} aria-label="Loading" />
);

// ─── Form fields ─────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
}

export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? (
        <p id={msgId} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = (error?: string) =>
  cx(
    "h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-colors outline-none",
    "focus:border-ink focus-visible:outline-none",
    error ? "border-danger" : "border-line",
  );

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, className, ...rest },
  ref,
) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, describedBy) => (
        <input ref={ref} id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy} className={inputClass(error)} {...rest} />
      )}
    </Field>
  );
});

/** Password input with a show/hide toggle. */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, "type">>(function PasswordField(
  { label, error, hint, className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, describedBy) => (
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={visible ? "text" : "password"}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={cx(inputClass(error), "pr-12")}
            autoCapitalize="none"
            spellCheck={false}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            title={visible ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-1 my-auto inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          >
            {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
      )}
    </Field>
  );
});

export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, describedBy) => (
        <div className="relative">
          <select id={id} aria-describedby={describedBy} className={cx(inputClass(error), "appearance-none pr-10")} {...rest}>
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute inset-y-0 right-3.5 my-auto size-4 text-muted" aria-hidden />
        </div>
      )}
    </Field>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[15px] font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-ink" : "bg-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-surface shadow transition-transform",
            checked && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}

// ─── Surfaces ────────────────────────────────────────────────────────────
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx("rounded-[18px] border border-line bg-surface", className)}>{children}</div>
);

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "ok" | "warn" | "danger"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    accent: "bg-accent-soft text-accent",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.38) };
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        style={style}
        onError={() => setBroken(true)}
        className={cx("shrink-0 rounded-full object-cover ring-1 ring-line", className)}
      />
    );
  }
  return (
    <span
      style={style}
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-ink-2", className)}
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center animate-rise">
      <div className="frame mb-5 flex size-20 items-center justify-center rounded-2xl text-muted [--frame-inset:0px] [--frame-len:14px]">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[15px] text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ─── Modal (native <dialog>: focus trap + Esc for free) ──────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[22px] bg-surface p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-[2px]",
        "sm:m-auto sm:rounded-[22px]",
        widths[size],
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col animate-pop">
          <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-5" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 pb-safe">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display text-[19px] font-bold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path
          d="M8 13V8h5M19 8h5v5M24 19v5h-5M13 24H8v-5"
          fill="none"
          stroke="var(--bg)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16" r="3.2" fill="var(--accent)" />
      </svg>
      <span>
        In<span className="text-accent">Frame</span>
      </span>
    </span>
  );
}
