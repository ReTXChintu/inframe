import { copyText } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, Copy, Download, Lock, Send, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import { KIND_LABEL, plural, prettyCode } from "@/lib/format";
import type { EventDetail } from "@/lib/types";
import { errorMessage, useFeedback } from "./feedback";
import { Button, Callout, cx, Modal, SelectField } from "./ui";

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
    QRCode.toDataURL(link, { margin: 1, width: 640, errorCorrectionLevel: "M", color: { dark: "#18191d", light: "#ffffff" } })
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
            {/* The QR stays black on white in both themes so every camera can read it. */}
            <div className="mx-auto w-[180px] rounded-xl border border-ln bg-white p-3">
              {qr ? <img src={qr} alt={`QR code to join ${event.name}`} className="w-full" /> : <div className="aspect-square skeleton rounded-sm" />}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <p className="text-label text-tx2">Join code</p>
                <button
                  onClick={() => copy(code, "code")}
                  className="mt-1 inline-flex items-center gap-2 rounded-md font-mono text-[28px] leading-[34px] font-medium tracking-[0.08em] text-tx transition-colors hover:text-ac"
                  aria-label={`Copy code ${prettyCode(code)}`}
                >
                  {prettyCode(code)}
                  {copied === "code" ? <Check className="size-5 text-good" /> : <Copy className="size-5 text-tx3" />}
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-ln2 bg-sf2 p-1 pl-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-tx2">{link}</span>
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
          <Callout tone="neutral" icon={<Lock />}>
            Joining with a code is turned off for this {KIND_LABEL[event.kind].toLowerCase()}. {event.isHost ? "Turn it on in settings, or invite people by email below." : "Ask a host to invite you."}
          </Callout>
        )}

        {event.isHost && (
          <form
            className="flex flex-col gap-3 border-t border-ln pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed.length && !invalid.length) invite.mutate();
            }}
          >
            <div>
              <h3 className="text-title-card">Invite by email</h3>
              <p className="mt-0.5 text-body-s text-tx3">They get a link to join. If they're new, they create an account first.</p>
            </div>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={3}
              placeholder="priya@example.com, rahul@example.com"
              aria-label="Email addresses"
              aria-invalid={invalid.length > 0}
              className={cx(
                "w-full resize-none rounded-md border bg-sf px-3.5 py-3 text-[15px] text-tx outline-none placeholder:text-tx3 focus:border-2 focus:border-ac focus:px-[13px] focus:py-[11px]",
                invalid.length > 0 ? "border-2 border-crit px-[13px] py-[11px]" : "border-ln2",
              )}
            />
            {invalid.length > 0 && <p className="text-caption text-crit">Check these: {invalid.join(", ")}</p>}
            <div className="flex flex-wrap items-end gap-3">
              {event.isOwner && (
                <SelectField label="Invite as" value={role} onChange={(e) => setRole(e.target.value as "member" | "cohost")} className="w-44">
                  <option value="member">Guest</option>
                  <option value="cohost">Co-host</option>
                </SelectField>
              )}
              <Button type="submit" size="lg" icon={<Send className="size-[18px]" />} disabled={!parsed.length || invalid.length > 0} loading={invite.isPending} className="ml-auto">
                Send {parsed.length > 1 ? `${parsed.length} invites` : "invite"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
