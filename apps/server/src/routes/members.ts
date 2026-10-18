import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser } from "../auth/guard.js";
import { one, query, tx } from "../db/pool.js";
import { normalizeJoinCode, randomToken, sha256 } from "../lib/crypto.js";
import { badRequest, forbidden, notFound, parse } from "../lib/errors.js";
import { sendMail } from "../lib/mailer.js";
import { evictFromEvent, toEvent, toUser } from "../realtime/io.js";
import { eventAccess, hostAccess } from "../services/access.js";
import { clearMemberMatches, matchMemberInEvent } from "../services/matching.js";
import { email, idParam, parseId } from "./shared.js";

const INVITE_DAYS = 14;
const KIND_LABEL: Record<string, string> = { trip: "trip", wedding: "wedding", party: "party", other: "event" };

/** Add a user to an event (no-op if already in) and find them in its photos. */
async function addMember(eventId: string, userId: string, role: "cohost" | "member") {
  const inserted = await one(
    `INSERT INTO event_members (event_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO UPDATE
       SET role = CASE WHEN event_members.role = 'member' AND EXCLUDED.role = 'cohost' THEN 'cohost' ELSE event_members.role END
     RETURNING (xmax = 0) AS fresh`,
    [eventId, userId, role],
  );
  const matched = await matchMemberInEvent(userId, eventId);
  if (inserted?.fresh) toEvent(eventId, "event:members", { eventId });
  return { matched };
}

const eventPreview = async (eventId: string) =>
  one(
    `SELECT e.id, e.name, e.kind, e.starts_on AS "startsOn", e.ends_on AS "endsOn", u.name AS "ownerName",
            (SELECT count(*)::int FROM event_members m WHERE m.event_id = e.id) AS "memberCount"
       FROM events e JOIN users u ON u.id = e.owner_id WHERE e.id = $1`,
    [eventId],
  );

export async function memberRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  // ─── Members ───────────────────────────────────────────────────────────
  app.get("/api/events/:id/members", async (req) => {
    const id = parseId(req.params);
    const access = await eventAccess(id, req.user.id);
    const rows = await query<{ user_id: string; name: string; email: string; role: string; joined_at: Date }>(
      `SELECT m.user_id, u.name, u.email, m.role, m.joined_at
         FROM event_members m JOIN users u ON u.id = m.user_id
        WHERE m.event_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'cohost' THEN 1 ELSE 2 END, lower(u.name)`,
      [id],
    );
    return {
      members: rows.map((m) => ({
        userId: m.user_id,
        name: m.name,
        // Hosts see emails (to manage people); guests see names only.
        email: access.isHost || m.user_id === req.user.id ? m.email : null,
        role: m.role,
        joinedAt: m.joined_at,
        isYou: m.user_id === req.user.id,
      })),
    };
  });

  const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

  /** Owner only: promote a member to co-host or back. */
  app.patch("/api/events/:id/members/:userId", async (req) => {
    const { id, userId } = parse(memberParams, req.params);
    const access = await eventAccess(id, req.user.id);
    if (!access.isOwner) throw forbidden("Only the owner can change roles.");
    const { role } = parse(z.object({ role: z.enum(["cohost", "member"]) }), req.body);
    if (userId === req.user.id) throw badRequest("You're the owner — your role can't change.");
    const updated = await one("UPDATE event_members SET role = $3 WHERE event_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING 1", [
      id,
      userId,
      role,
    ]);
    if (!updated) throw notFound("Member");
    toEvent(id, "event:members", { eventId: id });
    toUser(userId, "event:updated", { eventId: id });
    return { ok: true };
  });

  /** Hosts remove people; anyone can remove themselves ("leave"). The owner can't leave. */
  app.delete("/api/events/:id/members/:userId", async (req) => {
    const { id, userId } = parse(memberParams, req.params);
    const access = await eventAccess(id, req.user.id);
    const target = await one<{ role: string }>("SELECT role FROM event_members WHERE event_id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    if (!target) throw notFound("Member");
    const self = userId === req.user.id;
    if (target.role === "owner") throw forbidden(self ? "The owner can't leave. Delete the event instead." : "The owner can't be removed.");
    if (!self) {
      if (!access.isHost) throw forbidden("Only hosts can remove people.");
      if (target.role === "cohost" && !access.isOwner) throw forbidden("Only the owner can remove a co-host.");
    }
    await tx(async (db) => {
      await db.query("DELETE FROM event_members WHERE event_id = $1 AND user_id = $2", [id, userId]);
      await clearMemberMatches(userId, id, db);
    });
    evictFromEvent(userId, id);
    toEvent(id, "event:members", { eventId: id });
    toUser(userId, "event:removed", { eventId: id });
    return { ok: true };
  });

  // ─── Join by code / link / QR ──────────────────────────────────────────
  const codeParam = z.object({ code: z.string().min(4).max(20) });
  const joinLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  async function eventByCode(rawCode: string) {
    const code = normalizeJoinCode(rawCode);
    const event = await one<{ id: string; join_enabled: boolean }>("SELECT id, join_enabled FROM events WHERE join_code = $1", [code]);
    if (!event || !event.join_enabled) throw notFound("An event with that code");
    return event;
  }

  app.get("/api/join/:code", joinLimit, async (req) => {
    const { code } = parse(codeParam, req.params);
    const event = await eventByCode(code);
    const member = await one("SELECT 1 FROM event_members WHERE event_id = $1 AND user_id = $2", [event.id, req.user.id]);
    return { event: await eventPreview(event.id), isMember: Boolean(member) };
  });

  app.post("/api/join/:code", joinLimit, async (req) => {
    const { code } = parse(codeParam, req.params);
    const event = await eventByCode(code);
    const { matched } = await addMember(event.id, req.user.id, "member");
    return { eventId: event.id, matched };
  });

  // ─── Email invites ─────────────────────────────────────────────────────
  app.post("/api/events/:id/invites", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const id = parseId(req.params);
    const access = await hostAccess(id, req.user.id);
    const body = parse(
      z.object({
        emails: z.array(email).min(1, "Add at least one email.").max(50, "Invite up to 50 people at a time."),
        role: z.enum(["cohost", "member"]).default("member"),
      }),
      req.body,
    );
    if (body.role === "cohost" && !access.isOwner) throw forbidden("Only the owner can invite co-hosts.");

    const unique = [...new Set(body.emails)];
    const existing = new Set(
      (await query<{ email: string }>(
        "SELECT u.email FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = $1 AND u.email = ANY($2::citext[])",
        [id, unique],
      )).map((r) => r.email.toLowerCase()),
    );
    const e = access.event;
    let sent = 0;
    const skipped: string[] = [];
    for (const to of unique) {
      if (existing.has(to)) {
        skipped.push(to);
        continue;
      }
      const token = randomToken();
      await query(
        `INSERT INTO event_invites (event_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
         ON CONFLICT (event_id, email) WHERE accepted_at IS NULL
         DO UPDATE SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash, invited_by = EXCLUDED.invited_by,
                       expires_at = EXCLUDED.expires_at, created_at = now()`,
        [id, to, body.role, sha256(token), req.user.id, INVITE_DAYS],
      );
      await sendMail({
        to,
        subject: `${req.user.name} invited you to "${e.name}" on InFrame`,
        lines: [
          `${req.user.name} invited you to join the ${KIND_LABEL[e.kind]} "${e.name}"${body.role === "cohost" ? " as a co-host" : ""}.`,
          "Add your photos to the shared album, and take a quick selfie — InFrame finds every photo you're in.",
          `This invite is valid for ${INVITE_DAYS} days.`,
        ],
        action: { label: "Open the invite", url: `${config.appUrl}/invite/${token}` },
      });
      // Already on InFrame? Show it in their app straight away.
      const invitee = await one<{ id: string }>("SELECT id FROM users WHERE email = $1", [to]);
      if (invitee) toUser(invitee.id, "invites:changed", {});
      sent++;
    }
    return { sent, skipped };
  });

  app.get("/api/events/:id/invites", async (req) => {
    const id = parseId(req.params);
    await hostAccess(id, req.user.id);
    const rows = await query(
      `SELECT i.id, i.email, i.role, i.created_at AS "createdAt", i.expires_at AS "expiresAt", u.name AS "invitedBy"
         FROM event_invites i LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.event_id = $1 AND i.accepted_at IS NULL
        ORDER BY i.created_at DESC`,
      [id],
    );
    return { invites: rows };
  });

  app.delete("/api/events/:id/invites/:inviteId", async (req) => {
    const { id, inviteId } = parse(z.object({ id: z.string().uuid(), inviteId: z.string().uuid() }), req.params);
    await hostAccess(id, req.user.id);
    await query("DELETE FROM event_invites WHERE id = $1 AND event_id = $2 AND accepted_at IS NULL", [inviteId, id]);
    return { ok: true };
  });

  /** Invites addressed to the signed-in user's email. */
  app.get("/api/invites", async (req) => {
    const rows = await query(
      `SELECT i.id, i.role, i.created_at AS "createdAt", u.name AS "invitedBy",
              e.id AS "eventId", e.name AS "eventName", e.kind AS "eventKind",
              e.starts_on AS "startsOn", e.ends_on AS "endsOn"
         FROM event_invites i
         JOIN events e ON e.id = i.event_id
         LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.email = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = i.event_id AND m.user_id = $2)
        ORDER BY i.created_at DESC`,
      [req.user.email, req.user.id],
    );
    return { invites: rows };
  });

  interface InviteRow {
    id: string;
    event_id: string;
    email: string;
    role: "cohost" | "member";
  }
  const openInvite = `accepted_at IS NULL AND expires_at > now()`;

  /** Look an emailed invite up by its link token (any signed-in account may use the link). */
  app.get("/api/invites/token/:token", async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(100) }), req.params);
    const invite = await one<InviteRow>(`SELECT * FROM event_invites WHERE token_hash = $1 AND ${openInvite}`, [sha256(token)]);
    if (!invite) throw notFound("This invite (it may have expired or already been used)");
    const member = await one("SELECT 1 FROM event_members WHERE event_id = $1 AND user_id = $2", [invite.event_id, req.user.id]);
    return {
      invite: { id: invite.id, role: invite.role, email: invite.email, forYou: invite.email.toLowerCase() === req.user.email.toLowerCase() },
      event: await eventPreview(invite.event_id),
      isMember: Boolean(member),
    };
  });

  async function accept(invite: InviteRow, userId: string) {
    await query("UPDATE event_invites SET accepted_at = now() WHERE id = $1", [invite.id]);
    const { matched } = await addMember(invite.event_id, userId, invite.role);
    toUser(userId, "invites:changed", {});
    return { eventId: invite.event_id, matched };
  }

  app.post("/api/invites/token/:token/accept", async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(100) }), req.params);
    const invite = await one<InviteRow>(`SELECT * FROM event_invites WHERE token_hash = $1 AND ${openInvite}`, [sha256(token)]);
    if (!invite) throw notFound("This invite (it may have expired or already been used)");
    return accept(invite, req.user.id);
  });

  app.post("/api/invites/:id/accept", async (req) => {
    const { id } = parse(idParam, req.params);
    const invite = await one<InviteRow>(`SELECT * FROM event_invites WHERE id = $1 AND email = $2 AND ${openInvite}`, [
      id,
      req.user.email,
    ]);
    if (!invite) throw notFound("Invite");
    return accept(invite, req.user.id);
  });

  app.post("/api/invites/:id/decline", async (req) => {
    const { id } = parse(idParam, req.params);
    await query(`DELETE FROM event_invites WHERE id = $1 AND email = $2 AND accepted_at IS NULL`, [id, req.user.email]);
    toUser(req.user.id, "invites:changed", {});
    return { ok: true };
  });
}
