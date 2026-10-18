import { z } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to this.") => new AppError(403, "forbidden", message);
export const notFound = (what = "That") => new AppError(404, "not_found", `${what} was not found.`);
export const conflict = (message: string) => new AppError(409, "conflict", message);

/** Parse untrusted input; a failure becomes a 400 with per-field messages. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    const first = Object.values(fields)[0] ?? "Invalid input.";
    throw new AppError(400, "validation", first, { fields });
  }
  return result.data;
}
