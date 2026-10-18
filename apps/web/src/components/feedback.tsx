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
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-20"
      >
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-[14px] text-bg shadow-xl animate-rise"
            >
              <Icon className={cx("size-5 shrink-0", t.tone === "error" ? "text-[#ff8a75]" : t.tone === "ok" ? "text-[#6ee0ad]" : "text-bg/70")} />
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.action && (
                <button
                  className="font-semibold text-accent"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-bg/60 hover:text-bg">
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
            <Button variant="secondary" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant={pending?.danger ? "danger" : "primary"} onClick={() => settle(true)} autoFocus>
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {pending?.body && <div className="text-[15px] text-muted">{pending.body}</div>}
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
