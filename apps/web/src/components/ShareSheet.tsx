import { copyText } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, Copy, Download, Send, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import { KIND_LABEL, plural, prettyCode } from "@/lib/format";
import type { EventDetail } from "@/lib/types";
import { errorMessage, useFeedback } from "./feedback";
import { Button, Modal, SelectField } from "./ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ShareSheet({ event, open, onClose }: { event: EventDetail; open: boolean; onClose: () => void }) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"member" | "cohost">("member");

  const code = event.joinCode;
  const link = code ? `${window.location.origin}/join/${code}` : null;

  useEffect(() => {
    if (!open || !link) return;
    QRCode.toDataURL(link, { margin: 1, width: 640, errorCorrectionLevel: "M", color: { dark: "#17161b", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [open, link]);

  const parsed = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const invalid = parsed.filter((e) => !EMAIL_RE.test(e));

  const invite = useMutation({
    mutationFn: () => api<{ sent: number; skipped: string[] }>(`/api/events/${event.id}/invites`, { body: { emails: parsed, role } }),
    onSuccess: ({ sent, skipped }) => {
      setEmails("");
      qc.invalidateQueries({ queryKey: ["invites", event.id] });
      toast(
        sent
          ? `Invite sent to ${plural(sent, "person", "people")}${skipped.length ? ` (${skipped.length} already in)` : ""}.`
          : "They're all already in the event.",
      );
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  async function copy(text: string, what: "link" | "code") {
    try {
      await copyText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast("Couldn't copy — select and copy it manually.", "error");
    }
  }

  const shareText = `Join "${event.name}" on InFrame — add your photos and find the ones you're in.`;

  return (
    <Modal open={open} onClose={onClose} title="Invite people" size="md">
      <div className="flex flex-col gap-6">
        {link && code ? (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
            <div className="frame mx-auto w-[180px] rounded-2xl bg-white p-3 text-ink [--frame-inset:-4px] [--frame-len:22px]">
              {qr ? <img src={qr} alt={`QR code to join ${event.name}`} className="w-full" /> : <div className="aspect-square skeleton rounded" />}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">Join code</p>
                <button
                  onClick={() => copy(code, "code")}
                  className="mt-1 inline-flex items-center gap-2 font-display text-3xl font-semibold tracking-[0.08em] tabular-nums hover:text-accent"
                  aria-label={`Copy code ${prettyCode(code)}`}
                >
                  {prettyCode(code)}
                  {copied === "code" ? <Check className="size-5 text-ok" /> : <Copy className="size-5 text-muted" />}
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-1 pl-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{link}</span>
                <Button size="sm" variant="secondary" icon={copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => copy(link, "link")}>
                  {copied === "link" ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {"share" in navigator && (
                  <Button size="sm" icon={<Share2 className="size-4" />} onClick={() => navigator.share({ title: event.name, text: shareText, url: link }).catch(() => {})}>
                    Share
                  </Button>
                )}
                <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${link}`)}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="secondary">WhatsApp</Button>
                </a>
                {qr && (
                  <a href={qr} download={`${event.name} – InFrame QR.png`}>
                    <Button size="sm" variant="secondary" icon={<Download className="size-4" />}>
                      QR image
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-surface-2 p-4 text-[14px] text-muted">
            Joining with a code is turned off for this {KIND_LABEL[event.kind].toLowerCase()}. {event.isHost ? "Turn it on in settings, or invite people by email below." : "Ask a host to invite you."}
          </p>
        )}

        {event.isHost && (
          <form
            className="flex flex-col gap-3 border-t border-line pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed.length && !invalid.length) invite.mutate();
            }}
          >
            <div>
              <h3 className="font-semibold">Invite by email</h3>
              <p className="text-[13px] text-muted">They get a link to join. If they're new, they create an account first.</p>
            </div>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={3}
              placeholder="priya@example.com, rahul@example.com"
              aria-label="Email addresses"
              className="w-full resize-none rounded-xl border border-line bg-surface p-3 text-[15px] outline-none focus:border-ink"
            />
            {invalid.length > 0 && <p className="text-[13px] text-danger">Check these: {invalid.join(", ")}</p>}
            <div className="flex flex-wrap items-end gap-3">
              {event.isOwner && (
                <SelectField label="Invite as" value={role} onChange={(e) => setRole(e.target.value as "member" | "cohost")} className="w-44">
                  <option value="member">Guest</option>
                  <option value="cohost">Co-host</option>
                </SelectField>
              )}
              <Button type="submit" icon={<Send className="size-4" />} disabled={!parsed.length || invalid.length > 0} loading={invite.isPending} className="ml-auto">
                Send {parsed.length > 1 ? `${parsed.length} invites` : "invite"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
