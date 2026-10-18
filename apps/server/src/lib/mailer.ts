import nodemailer, { type Transporter } from "nodemailer";
import { onSettingsChange, smtpSettings } from "../services/settings.js";

// Built from the current SMTP settings and rebuilt when the admin changes them.
let transport: Transporter | null | undefined;
onSettingsChange(() => {
  transport?.close();
  transport = undefined;
});

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  const s = smtpSettings();
  transport = s.host
    ? nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: s.user ? { user: s.user, pass: s.pass ?? "" } : undefined,
        connectionTimeout: 15_000,
      })
    : null;
  return transport;
}

export const mailConfigured = () => Boolean(smtpSettings().host);

interface Mail {
  to: string;
  subject: string;
  /** Plain paragraphs; the action is rendered as a button. */
  lines: string[];
  action: { label: string; url: string };
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render({ lines, action }: Mail) {
  const paragraphs = lines.map((l) => `<p style="margin:0 0 14px;line-height:1.5">${escape(l)}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f2ec;padding:32px 16px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#17161b">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <div style="font-weight:700;font-size:20px;margin-bottom:24px">In<span style="color:#f2542d">Frame</span></div>
    ${paragraphs}
    <p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#17161b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block;font-weight:600">${escape(action.label)}</a></p>
    <p style="margin:0;color:#77727f;font-size:13px;line-height:1.5">Or paste this link into your browser:<br>${escape(action.url)}</p>
  </div></body></html>`;
}

/**
 * Send an email. Without SMTP settings it's printed to the server log instead
 * (handy in development). `strict` makes delivery failures throw — used by the
 * admin's "send test email" button; normal mail just logs failures.
 */
export async function sendMail(mail: Mail, { strict = false } = {}) {
  const text = `${mail.lines.join("\n\n")}\n\n${mail.action.label}: ${mail.action.url}`;
  const t = getTransport();
  if (!t) {
    if (strict) throw new Error("SMTP isn't configured — set a host first.");
    console.log(`\n[mail] (SMTP not configured — printing instead)\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${text}\n`);
    return;
  }
  try {
    await t.sendMail({ from: smtpSettings().from, to: mail.to, subject: mail.subject, text, html: render(mail) });
  } catch (err) {
    if (strict) throw err;
    console.error(`[mail] couldn't send "${mail.subject}" to ${mail.to}: ${(err as Error).message}`);
  }
}
