/** L2-normalise an embedding so cosine similarity is a plain dot product. */
export function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) throw new Error("Face embedding is empty or invalid.");
  return vec.map((x) => x / norm);
}

/** pgvector text literal: "[0.1,0.2,…]". */
export const toVector = (vec: number[]) => `[${vec.join(",")}]`;
