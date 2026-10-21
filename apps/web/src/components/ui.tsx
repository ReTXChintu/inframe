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

// ─── Buttons (design system §7.1) ────────────────────────────────────────
// primary = accent fill; secondary = surface + strong line; ghost = accent text;
// danger = outlined destructive; dangerFill = the final "Delete" inside a dialog.
type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "dangerFill";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  primary: "bg-ac text-ac-tx hover:bg-ac-hover disabled:bg-sunk disabled:text-tx3",
  accent: "bg-ac text-ac-tx hover:bg-ac-hover disabled:bg-sunk disabled:text-tx3",
  secondary: "border border-ln2 bg-sf text-tx hover:bg-sf2 active:bg-sunk disabled:border-ln disabled:text-tx3",
  ghost: "text-ac hover:bg-sf2 active:bg-sunk disabled:text-tx3",
  danger: "border border-crit-soft text-crit hover:bg-crit-soft disabled:text-tx3",
  dangerFill: "bg-crit-fill text-white hover:brightness-95 disabled:bg-sunk disabled:text-tx3",
};
/** 36 (radius 10, 13/600) · 40 (header, 14/600) · 48 (forms, dialogs, cards) · 52 (sign-in). */
const sizes: Record<Size, string> = {
  sm: "h-9 rounded-md px-3 text-[13px] gap-1.5",
  md: "h-10 rounded-lg px-4 text-[14px] gap-2",
  lg: "h-12 rounded-lg px-5 text-[15px] gap-2",
  xl: "h-13 rounded-lg px-6 text-[15px] gap-2.5",
};
const buttonBase =
  "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap select-none transition-colors duration-[120ms] disabled:cursor-not-allowed [&_svg]:shrink-0";

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
      aria-busy={loading || undefined}
      className={cx(buttonBase, variants[variant], sizes[size], className)}
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
    <Link to={to} className={cx(buttonBase, variants[variant], sizes[size], className)} {...rest}>
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
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms] disabled:cursor-not-allowed",
        variant === "ghost" && "text-tx2 hover:bg-sf2 hover:text-tx active:bg-sunk disabled:text-ln2",
        variant === "secondary" && "border border-ln2 bg-sf text-tx hover:bg-sf2 disabled:text-ln2",
        variant === "glass" && "bg-white/14 text-white hover:bg-white/24 disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** §7.8 spinner: a --sunk ring with a quarter arc in the accent. `onDark` is for the photo stage and camera. */
export const Spinner = ({ className, size = 28, onDark = false }: { className?: string; size?: number; onDark?: boolean }) => (
  <svg
    viewBox="0 0 28 28"
    role="img"
    aria-label="Loading"
    width={size}
    height={size}
    className={cx("shrink-0 animate-spin [animation-duration:900ms]", onDark ? "text-white" : "text-ac", className)}
  >
    <circle cx="14" cy="14" r="12" fill="none" stroke={onDark ? "rgba(255,255,255,0.18)" : "var(--sunk)"} strokeWidth="3" />
    <path d="M14 2a12 12 0 0 1 12 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ─── Page header (title-page h1, a plain-words lede, actions on the right) ─
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-label text-tx2">{eyebrow}</div>}
        <h1 className="text-title-page break-words text-tx">{title}</h1>
        {description && <p className="mt-1 text-body-l text-tx2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ─── Form fields (§7.2) ──────────────────────────────────────────────────
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
      <label htmlFor={id} className="text-label text-tx2">
        {label}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? (
        <p id={msgId} className="text-caption text-crit">
          {error}
        </p>
      ) : hint ? (
        <div id={msgId} className="text-caption text-tx3">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** 52 px field, radius 10, 1px --ln2; focus and invalid are 2px with the padding pulled in 1px. */
export const inputClass = (error?: string) =>
  cx(
    "h-13 w-full rounded-md border bg-sf px-3.5 text-[15px] text-tx outline-none transition-colors duration-[120ms] placeholder:text-tx3",
    // Read-only applies to text inputs only: Chrome treats every <select> as :read-only.
    "focus:border-2 focus:border-ac focus:px-[13px] [&:is(input):read-only]:bg-sf2 [&:is(input):read-only]:text-tx2 disabled:bg-sf2 disabled:text-tx2",
    error ? "border-2 border-crit px-[13px]" : "border-ln2",
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

/**
 * Password / secret input with the eye button (required on every secret).
 * `noun` names the object in the button's label: "Show password", "Show key"…
 * Revealed values switch to Plex Mono so ambiguous characters are clear.
 */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, "type"> & { noun?: string }>(function PasswordField(
  { label, error, hint, className, noun = "password", ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = `${visible ? "Hide" : "Show"} ${noun}`;
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
            className={cx(inputClass(error), "pr-13 focus:pr-[51px]", visible && "font-mono")}
            autoCapitalize="none"
            spellCheck={false}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={toggleLabel}
            aria-pressed={visible}
            aria-controls={id}
            title={toggleLabel}
            className="absolute top-0.5 right-0.5 inline-flex size-12 items-center justify-center rounded-md text-tx2 transition-colors hover:bg-sf2 hover:text-tx"
          >
            {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
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
          <select id={id} aria-describedby={describedBy} className={cx(inputClass(error), "appearance-none pr-11 focus:pr-11")} {...rest}>
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute inset-y-0 right-3.5 my-auto size-5 text-tx2" aria-hidden />
        </div>
      )}
    </Field>
  );
}

/** §7.2 switch row: 48 min-height, 14/20 label + 12 sub-line, 52×32 switch trailing. */
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
    <div className="flex min-h-12 items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-body text-tx">
          {label}
        </label>
        {description && <p className="mt-0.5 text-caption text-tx3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-8 w-13 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50",
          checked ? "bg-ac" : "bg-ln2",
        )}
      >
        <span
          className={cx(
            "absolute top-1 left-1 size-6 rounded-full transition-transform duration-200 ease-ds",
            checked ? "translate-x-5 bg-ac-tx" : "bg-sf",
          )}
        />
      </button>
    </div>
  );
}

// ─── Surfaces (§7.5) ─────────────────────────────────────────────────────
/** Flat section card: --sf, 1px --ln, radius 14, never a shadow. */
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx("rounded-xl border border-ln bg-sf", className)}>{children}</div>
);

type Tone = "neutral" | "accent" | "ok" | "good" | "warn" | "danger" | "crit" | "outline";
const badgeTones: Record<Tone, string> = {
  neutral: "bg-sunk text-tx2",
  accent: "bg-ac-soft text-ac",
  ok: "bg-good-soft text-good",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-crit-soft text-crit",
  crit: "bg-crit-soft text-crit",
  outline: "text-tx2 shadow-[inset_0_0_0_1px_var(--ln2)]",
};

/** 24 h, radius 6, 12/600: soft fill + strong text. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const tileTones: Record<"accent" | "good" | "warn" | "crit" | "neutral" | "muted" | "onTint", string> = {
  accent: "bg-ac-soft text-ac",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  neutral: "bg-sunk text-tx2",
  muted: "bg-sunk text-tx3", // empty states
  onTint: "bg-sf", // icon colour comes from the tinted row it sits on (or className)
};

/** 40×40 (or 36) radius-10 tile: soft tint behind a 20 px icon in the strong tint. */
export function IconTile({
  tone = "accent",
  size = 40,
  children,
  className,
}: {
  tone?: keyof typeof tileTones;
  size?: 36 | 40 | 48;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md [&_svg]:size-5",
        size === 48 && "[&_svg]:size-6",
        tileTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const calloutTones = {
  info: "bg-ac-soft text-tx",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  good: "bg-good-soft text-good",
  neutral: "bg-sunk text-tx2",
} as const;

/** §7.5 callout / banner: radius 12, padding 12×16, 20 px icon, optional trailing action. */
export function Callout({
  tone = "info",
  icon,
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: keyof typeof calloutTones;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cx(
        "flex flex-col gap-3 rounded-lg px-4 py-3 sm:flex-row sm:items-center",
        tone === "info" && "py-3.5",
        calloutTones[tone],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon && <span className={cx("mt-px shrink-0 [&_svg]:size-5", tone === "info" && "text-ac")}>{icon}</span>}
        <div className="min-w-0 flex-1">
          {title && <p className={cx("font-medium", tone === "info" ? "text-body" : "text-body-l")}>{title}</p>}
          {children && (
            <div className={cx(title ? "mt-0.5 text-caption" : "text-body", tone === "info" || tone === "neutral" ? "text-tx2" : "")}>
              {children}
            </div>
          )}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Inline error banner (§7.11): --crit-soft, radius 12, 20 px icon. */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-crit-soft px-3.5 py-2.5 text-body font-medium text-crit">
      {children}
    </p>
  );
}

/** Filter / choice chip (§7.4): 36 h pill; selected is ink-filled. */
export function Chip({
  selected,
  children,
  count,
  dashed,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; count?: number | null; dashed?: boolean }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-[120ms]",
        dashed && !selected && "border-dashed",
        selected ? "border-tx bg-tx text-bg" : "border-ln2 bg-sf text-tx hover:bg-sf2",
        className,
      )}
      {...rest}
    >
      {children}
      {count !== null && count !== undefined && (
        <span className={cx("num font-semibold", selected ? "text-bg/70" : "text-tx3")}>{count}</span>
      )}
    </button>
  );
}

/** Person avatar: circle, initials in a soft tint when there's no photo. */
export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) };
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        style={style}
        onError={() => setBroken(true)}
        className={cx("shrink-0 rounded-full object-cover shadow-[inset_0_0_0_1px_var(--ln)]", className)}
      />
    );
  }
  return (
    <span
      style={style}
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-ac-soft font-semibold text-ac", className)}
    >
      {initials(name)}
    </span>
  );
}

/** Full-page empty state (§7.11): 48 icon tile, one sentence, one action. One of the few centred things. */
export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center animate-rise">
      <IconTile tone="muted" size={48} className="mb-4">
        {icon}
      </IconTile>
      <h2 className="text-title-section text-tx">{title}</h2>
      {body && <p className="mt-1 max-w-md text-body-l text-tx2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ─── Modal (native <dialog>: focus trap + Esc for free) ──────────────────
// Desktop: a radius-20 dialog with the floating shadow. Phone: a bottom sheet
// (top corners 20, a drag handle) with the footer pinned.
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

  const widths = { sm: "sm:max-w-[400px]", md: "sm:max-w-[520px]", lg: "sm:max-w-2xl" };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl bg-sf p-0 text-tx shadow-2 backdrop:bg-scrim",
        "sm:m-auto sm:rounded-3xl",
        widths[size],
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col animate-pop">
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-xs bg-ln2 sm:hidden" aria-hidden />
          <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
            <h2 className="text-[19px] leading-6 font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-my-2 -mr-2">
              <X className="size-5" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-4 pb-5 sm:px-6 sm:pb-6">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-ln px-4 py-4 pb-safe sm:px-6">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}

/** §7.3 segmented control: --sunk track, radius 12, --sf thumb with the small lift. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-sunk p-1", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded-[9px] px-3.5 text-[13px] whitespace-nowrap transition-colors duration-200",
            value === o.value ? "bg-sf font-semibold text-tx shadow-1" : "font-medium text-tx2 hover:text-tx",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Four viewfinder corners (the shape of InFrame's mark), drawn in currentColor over a camera view. */
export function FrameCorners({ className, len = 26 }: { className?: string; len?: number }) {
  const s = { width: len, height: len };
  const c = "absolute border-current";
  return (
    <span aria-hidden className={cx("pointer-events-none absolute", className)}>
      <span style={s} className={cx(c, "top-0 left-0 rounded-tl-md border-t-2 border-l-2")} />
      <span style={s} className={cx(c, "top-0 right-0 rounded-tr-md border-t-2 border-r-2")} />
      <span style={s} className={cx(c, "bottom-0 left-0 rounded-bl-md border-b-2 border-l-2")} />
      <span style={s} className={cx(c, "right-0 bottom-0 rounded-br-md border-r-2 border-b-2")} />
    </span>
  );
}

/** The InFrame mark: the shared 28 px accent square (rx 8) with four frame corners, plus the 18/700 wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-[18px] leading-none font-bold tracking-[-0.01em] text-tx", className)}>
      <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden>
        <rect width="28" height="28" rx="8" fill="var(--ac)" />
        <path
          d="M7 11.5V7h4.5M16.5 7H21v4.5M21 16.5V21h-4.5M11.5 21H7v-4.5"
          fill="none"
          stroke="var(--ac-tx)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>InFrame</span>
    </span>
  );
}
