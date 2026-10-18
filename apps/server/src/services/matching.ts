import { modelSettings } from "./settings.js";
import { query, type Queryable, pool } from "../db/pool.js";

export interface MatchHit {
  person_id: string;
  owner_id: string;
  person_name: string;
  kind: "self" | "family";
}

/*
 * A person "is in" a photo when any face in it has cosine similarity above
 * the match threshold (Admin → Settings) with that person's selfie. Embeddings are L2-normalised,
 * so similarity = 1 - (a <=> b) with pgvector's cosine distance operator.
 * Only people owned by members of the photo's event are ever considered.
 */

/** Recompute every match for one photo (after its faces were (re)detected). */
export async function matchPhoto(photoId: string, db: Queryable = pool): Promise<MatchHit[]> {
  await query("DELETE FROM photo_matches WHERE photo_id = $1", [photoId], db);
  return query<MatchHit>(
    `WITH best AS (
       SELECT f.photo_id, pp.id AS person_id, max(1 - (f.embedding <=> pp.embedding)) AS score
         FROM faces f
         JOIN event_members m ON m.event_id = f.event_id
         JOIN people pp ON pp.owner_id = m.user_id AND pp.embedding IS NOT NULL
        WHERE f.photo_id = $1
        GROUP BY f.photo_id, pp.id
     ), saved AS (
       INSERT INTO photo_matches (photo_id, person_id, score)
       SELECT photo_id, person_id, score FROM best WHERE score > $2
       ON CONFLICT (photo_id, person_id) DO UPDATE SET score = EXCLUDED.score
       RETURNING person_id
     )
     SELECT pp.id AS person_id, pp.owner_id, pp.name AS person_name, pp.kind
       FROM saved JOIN people pp ON pp.id = saved.person_id`,
    [photoId, modelSettings().matchThreshold],
    db,
  );
}

/**
 * Recompute one person's matches — in a single event, or across every event
 * their owner belongs to. Returns the number of photos they're now in.
 */
export async function matchPerson(personId: string, eventId?: string, db: Queryable = pool): Promise<number> {
  const scope = eventId ? "AND ph.event_id = $2" : "";
  const params: unknown[] = eventId ? [personId, eventId] : [personId];
  await query(
    `DELETE FROM photo_matches pm USING photos ph
      WHERE pm.photo_id = ph.id AND pm.person_id = $1 ${scope}`,
    params,
    db,
  );
  const thresholdParam = `$${params.length + 1}`;
  const rows = await query<{ n: number }>(
    `WITH best AS (
       SELECT f.photo_id, pp.id AS person_id, max(1 - (f.embedding <=> pp.embedding)) AS score
         FROM people pp
         JOIN event_members m ON m.user_id = pp.owner_id
         JOIN faces f ON f.event_id = m.event_id
         JOIN photos ph ON ph.id = f.photo_id
        WHERE pp.id = $1 AND pp.embedding IS NOT NULL ${scope}
        GROUP BY f.photo_id, pp.id
     ), saved AS (
       INSERT INTO photo_matches (photo_id, person_id, score)
       SELECT photo_id, person_id, score FROM best WHERE score > ${thresholdParam}
       ON CONFLICT (photo_id, person_id) DO UPDATE SET score = EXCLUDED.score
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM saved`,
    [...params, modelSettings().matchThreshold],
    db,
  );
  return rows[0]?.n ?? 0;
}

/** After a user joins an event: match all their people against its photos. */
export async function matchMemberInEvent(userId: string, eventId: string): Promise<number> {
  const people = await query<{ id: string }>(
    "SELECT id FROM people WHERE owner_id = $1 AND embedding IS NOT NULL",
    [userId],
  );
  let total = 0;
  for (const p of people) total += await matchPerson(p.id, eventId);
  return total;
}

/** After a user leaves an event: their people's matches there no longer apply. */
export async function clearMemberMatches(userId: string, eventId: string, db: Queryable = pool) {
  await query(
    `DELETE FROM photo_matches pm USING photos ph, people pp
      WHERE pm.photo_id = ph.id AND ph.event_id = $2 AND pm.person_id = pp.id AND pp.owner_id = $1`,
    [userId, eventId],
    db,
  );
}
