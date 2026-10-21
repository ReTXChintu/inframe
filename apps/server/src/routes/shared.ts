import { z } from "zod";
import { parse } from "../lib/errors.js";
import { selfieUrl } from "../lib/media-urls.js";

export const idParam = z.object({ id: z.string().uuid("Not a valid id.") });
export const parseId = (params: unknown) => parse(idParam, params).id;

export const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const personName = z.string().trim().min(1, "Enter a name.").max(80);

export interface PersonRow {
  id: string;
  owner_id: string;
  kind: "self" | "family";
  name: string;
  relation: string | null;
  has_selfie: boolean;
  enrolled_at: Date | null;
  updated_at: Date;
  match_count?: number;
}

export function serializePerson(p: PersonRow) {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    relation: p.relation,
    hasSelfie: p.has_selfie,
    enrolledAt: p.enrolled_at,
    selfieUrl: p.has_selfie ? selfieUrl(p.id, p.enrolled_at) : null,
    matchCount: p.match_count ?? 0,
  };
}

/** Columns for `people` rows (alias pp) — never the embedding itself. */
export const PERSON_COLUMNS = "pp.id, pp.owner_id, pp.kind, pp.name, pp.relation, pp.has_selfie, pp.enrolled_at, pp.updated_at";
