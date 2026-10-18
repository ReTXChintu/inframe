import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { hashPassword, startSession, signAccessToken, verifyPassword } from "../auth/tokens.js";
import { one, query, tx } from "../db/pool.js";
import { AppError, badRequest, conflict, forbidden, notFound, parse } from "../lib/errors.js";
import { decodable, forModel, makeSelfie } from "../lib/images.js";
import { toVector } from "../lib/vector.js";
import { extractFaces, ModelError } from "../model/client.js";
import { matchPerson } from "../services/matching.js";
import { modelSettings } from "../services/settings.js";
import { serializeUser } from "./auth.js";
import { parseId, password, PERSON_COLUMNS, personName, serializePerson, type PersonRow } from "./shared.js";

const MAX_FAMILY = 12;

async function loadPerson(personId: string, ownerId: string): Promise<PersonRow> {
  const person = await one<PersonRow>(
    `SELECT ${PERSON_COLUMNS},
            (SELECT count(*)::int FROM photo_matches pm WHERE pm.person_id = pp.id) AS match_count
       FROM people pp WHERE pp.id = $1 AND pp.owner_id = $2`,
    [personId, ownerId],
  );
  if (!person) throw notFound("Person");
  return person;
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/me", async (req) => {
    const user = await one("SELECT id, email, name, is_admin, created_at FROM users WHERE id = $1", [req.user.id]);
    const self = await one<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM people pp WHERE owner_id = $1 AND kind = 'self'`, [
      req.user.id,
    ]);
    const invites = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM event_invites i
        WHERE i.email = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = i.event_id AND m.user_id = $2)`,
      [req.user.email, req.user.id],
    );
    return { user: serializeUser(user), self: self ? serializePerson(self) : null, pendingInvites: invites?.n ?? 0 };
  });

  app.patch("/api/me", async (req) => {
    const body = parse(z.object({ name: personName }), req.body);
    await tx(async (db) => {
      await db.query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1", [req.user.id, body.name]);
      await db.query("UPDATE people SET name = $2, updated_at = now() WHERE owner_id = $1 AND kind = 'self'", [
        req.user.id,
        body.name,
      ]);
    });
    return { ok: true };
  });

  app.post("/api/me/password", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(z.object({ currentPassword: z.string().min(1, "Enter your current password."), newPassword: password }), req.body);
    const user = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!user || !(await verifyPassword(user.password_hash, body.currentPassword))) {
      throw new AppError(400, "invalid_credentials", "Your current password isn't right.", {
        fields: { currentPassword: "Your current password isn't right." },
      });
    }
    const hash = await hashPassword(body.newPassword);
    const updated = await tx(async (db) => {
      const row = await one<{ token_version: number }>(
        "UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1 RETURNING token_version",
        [req.user.id, hash],
        db,
      );
      await db.query("DELETE FROM sessions WHERE user_id = $1", [req.user.id]);
      await startSession(reply, req.user.id, req.headers["user-agent"], db);
      return row!;
    });
    // Other devices are signed out; this one continues with a fresh token.
    return { accessToken: await signAccessToken(req.user.id, updated.token_version) };
  });

  app.delete("/api/me", async (req, reply) => {
    const body = parse(z.object({ password: z.string().min(1, "Enter your password to confirm.") }), req.body);
    const user = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!user || !(await verifyPassword(user.password_hash, body.password))) {
      throw new AppError(400, "invalid_credentials", "That password isn't right.", {
        fields: { password: "That password isn't right." },
      });
    }
    // Cascades to sessions, people (with selfies), connections and owned events.
    // Files in Drive/MEGA are left where they are.
    await query("DELETE FROM users WHERE id = $1", [req.user.id]);
    reply.clearCookie("inframe_rt", { path: "/api/auth" });
    return { ok: true };
  });

  // ─── People: me + family members ────────────────────────────────────────
  app.get("/api/people", async (req) => {
    const rows = await query<PersonRow>(
      `SELECT ${PERSON_COLUMNS},
              (SELECT count(*)::int FROM photo_matches pm WHERE pm.person_id = pp.id) AS match_count
         FROM people pp WHERE pp.owner_id = $1
        ORDER BY (pp.kind = 'self') DESC, pp.created_at`,
      [req.user.id],
    );
    return { people: rows.map(serializePerson) };
  });

  const familyBody = z.object({
    name: personName,
    relation: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  });

  app.post("/api/people", async (req, reply) => {
    const body = parse(familyBody, req.body);
    const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM people WHERE owner_id = $1 AND kind = 'family'", [
      req.user.id,
    ]);
    if ((count?.n ?? 0) >= MAX_FAMILY) throw conflict(`You can add up to ${MAX_FAMILY} family members.`);
    const row = await one<{ id: string }>(
      "INSERT INTO people (owner_id, kind, name, relation) VALUES ($1, 'family', $2, $3) RETURNING id",
      [req.user.id, body.name, body.relation],
    );
    reply.code(201);
    return { person: serializePerson(await loadPerson(row!.id, req.user.id)) };
  });

  app.patch("/api/people/:id", async (req) => {
    const id = parseId(req.params);
    const body = parse(familyBody.partial(), req.body);
    const person = await loadPerson(id, req.user.id);
    if (person.kind === "self" && body.name !== undefined) {
      throw badRequest("Change your own name in account settings.");
    }
    await query(
      `UPDATE people SET name = COALESCE($2, name), relation = CASE WHEN $4 THEN $3 ELSE relation END, updated_at = now()
        WHERE id = $1`,
      [id, body.name ?? null, body.relation ?? null, body.relation !== undefined],
    );
    return { person: serializePerson(await loadPerson(id, req.user.id)) };
  });

  app.delete("/api/people/:id", async (req) => {
    const id = parseId(req.params);
    const person = await loadPerson(id, req.user.id);
    if (person.kind === "self") throw forbidden("You can't remove yourself — remove your selfie instead.");
    await query("DELETE FROM people WHERE id = $1", [id]);
    return { ok: true };
  });

  /**
   * Enrol a face: the image must contain exactly one face. Its embedding
   * replaces the person's previous one and every match is recomputed.
   */
  app.post("/api/people/:id/selfie", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const id = parseId(req.params);
    await loadPerson(id, req.user.id);
    if (!modelSettings().url) {
      throw new AppError(503, "model_not_configured", "Face recognition isn't set up yet. Ask the admin to add the face model in Admin → Settings.");
    }
    const file = await req.file({ limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest("Attach a photo.");
    const raw = await file.toBuffer();
    if (file.file.truncated) throw badRequest("That photo is too large (15 MB max).");

    let faces;
    let image: Buffer;
    try {
      image = await decodable(raw, file.filename, file.mimetype);
      faces = await extractFaces(await forModel(image));
    } catch (err) {
      if (err instanceof ModelError) {
        throw new AppError(err.retryable ? 503 : 422, "model", err.retryable
          ? "Face recognition is unavailable right now. Try again in a minute."
          : "We couldn't read a face in that photo. Try another one.");
      }
      throw badRequest("That file isn't an image we can read.");
    }
    if (faces.length === 0) {
      throw new AppError(422, "no_face", "We couldn't find a face. Face the camera in good light, without sunglasses.");
    }
    if (faces.length > 1) {
      throw new AppError(422, "multiple_faces", "There's more than one face in that photo. Use one with only this person.");
    }

    // The small avatar copy lives in the database — nothing is written to disk.
    await query(
      `UPDATE people SET embedding = $2, selfie_image = $3, has_selfie = true, enrolled_at = now(), updated_at = now()
        WHERE id = $1`,
      [id, toVector(faces[0]!.embedding), await makeSelfie(image)],
    );
    const matchCount = await matchPerson(id);
    return { person: serializePerson(await loadPerson(id, req.user.id)), matchCount };
  });

  app.delete("/api/people/:id/selfie", async (req) => {
    const id = parseId(req.params);
    await loadPerson(id, req.user.id);
    await tx(async (db) => {
      await db.query(
        "UPDATE people SET embedding = NULL, selfie_image = NULL, has_selfie = false, enrolled_at = NULL, updated_at = now() WHERE id = $1",
        [id],
      );
      await db.query("DELETE FROM photo_matches WHERE person_id = $1", [id]);
    });
    return { person: serializePerson(await loadPerson(id, req.user.id)) };
  });
}
