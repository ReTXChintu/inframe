import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { verifySuiteSignature } from "../auth/suite.js";
import { AppError, parse } from "../lib/errors.js";
import { handleTrippinEvent, suiteUserExists, tripSummary, type TrippinDelivery } from "../services/trippin.js";

/*
 * Trippin → InFrame, server to server. No user tokens here: every request
 * must carry a valid suite signature (HMAC-SHA256 over the raw body with
 * TRIPPIN_SUITE_SECRET, see auth/suite.ts), checked before anything else runs.
 *
 *   POST /api/integrations/trippin/events                       trip.linked | updated | members_changed | unlinked
 *   GET  /api/integrations/trippin/trips/:trippinTripId/summary  ?sub=<viewer's identity sub>
 *   GET  /api/integrations/trippin/users/:sub                    { exists }
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .nullish()
  .transform((v) => v || null);

const sub = z.string().trim().min(1).max(255);
const person = z.object({
  sub,
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().max(200).nullish(),
});

const tripId = z.string().trim().min(1).max(200);

const fullTrip = z.object({
  id: tripId,
  title: z.string().trim().min(1, "The trip needs a title.").max(500),
  startDate: isoDate,
  endDate: isoDate,
  destination: z.string().max(500).nullish(),
  url: z.string().url().max(2000).nullish(),
  owner: person,
  members: z.array(person.extend({ role: z.enum(["owner", "editor", "viewer"]) })).max(1000).default([]),
});

const delivery = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.enum(["trip.linked", "trip.updated", "trip.members_changed", "trip.unlinked"]),
  occurredAt: z.string().max(100).nullish(),
  // Unlinking only needs to say which trip.
  trip: z.object({ id: tripId }).passthrough(),
});

/** Raw request bodies, kept for the signature check. */
const rawBodies = new WeakMap<FastifyRequest, Buffer>();

export async function trippinRoutes(app: FastifyInstance) {
  // Scoped to this plugin: keep the exact bytes that were signed, then parse.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    const raw = body as Buffer;
    rawBodies.set(req, raw);
    if (raw.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(raw.toString("utf8")));
    } catch {
      // Answered after the signature check (a 400 from validation), not before it.
      done(null, undefined);
    }
  });

  app.addHook("preHandler", async (req) => {
    const secret = config.trippinSecret;
    if (!secret) throw new AppError(503, "integration_disabled", "The Trippin integration isn't set up on this server.");
    const check = verifySuiteSignature({
      secret,
      timestamp: req.headers["x-suite-timestamp"],
      signature: req.headers["x-suite-signature"],
      rawBody: rawBodies.get(req) ?? Buffer.alloc(0),
    });
    if (!check.ok) {
      req.log.warn({ reason: check.reason }, "trippin: request with a bad suite signature refused");
      throw new AppError(
        401,
        "bad_signature",
        check.reason === "stale" ? "The request's timestamp is too far from the server's clock." : "The request isn't signed correctly.",
      );
    }
  });

  app.post("/api/integrations/trippin/events", async (req) => {
    const body = parse(delivery, req.body);
    const trip = body.type === "trip.unlinked" ? body.trip : parse(fullTrip, body.trip);
    return handleTrippinEvent({ id: body.id, type: body.type, trip } as TrippinDelivery, req.log);
  });

  app.get("/api/integrations/trippin/trips/:trippinTripId/summary", async (req, reply) => {
    const { trippinTripId } = parse(z.object({ trippinTripId: tripId }), req.params);
    const q = parse(z.object({ sub: sub.optional() }), req.query);
    const summary = await tripSummary(trippinTripId, q.sub);
    if (!summary) return reply.code(404).send({ linked: false });
    return summary;
  });

  app.get("/api/integrations/trippin/users/:sub", async (req) => {
    const params = parse(z.object({ sub }), req.params);
    return { exists: await suiteUserExists(params.sub) };
  });
}
