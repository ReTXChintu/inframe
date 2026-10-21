import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button, cx, Modal } from "./ui";

// ─── Toasts ──────────────────────────────────────────────────────────────
type Tone = "ok" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
  action?: { label: string; run: () => void };
}

interface Feedback {
  toast: (message: string, tone?: Tone, action?: ToastItem["action"]) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const toast = useCallback<Feedback["toast"]>((message, tone = "ok", action) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, tone, message, action }]);
    setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
  }, []);

  const confirm = useCallback<Feedback["confirm"]>(
    (opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const settle = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const icons = { ok: CheckCircle2, error: AlertCircle, info: Info };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-[76px] lg:top-4 lg:pl-[264px]"
      >
        {/* §7.12 inverse toast: --tx fill, --bg text, radius 12, floating shadow. */}
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex min-h-13 w-full max-w-md items-center gap-3 rounded-lg bg-tx py-2.5 pr-2 pl-4 text-body text-bg shadow-2 animate-rise"
            >
              <Icon className={cx("size-5 shrink-0", t.tone === "info" ? "text-bg/70" : "text-bg")} aria-hidden />
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.action && (
                <button
                  className="min-h-9 rounded-md px-3 text-[14px] font-bold text-bg underline underline-offset-2 hover:bg-bg/10"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-bg/70 hover:bg-bg/10 hover:text-bg"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
      <Modal
        open={Boolean(pending)}
        onClose={() => settle(false)}
        title={pending?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="lg" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant={pending?.danger ? "dangerFill" : "primary"} size="lg" onClick={() => settle(true)} autoFocus>
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {pending?.body && <div className="text-body-l text-tx2">{pending.body}</div>}
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback outside FeedbackProvider");
  return ctx;
}

/** Message for any thrown value. */
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
