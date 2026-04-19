export class HttpError extends Error {
	constructor(readonly status: number, msg: string, readonly code?: string) { super(msg); }
}
export class BadRequest   extends HttpError { constructor(msg = "bad request",  code?: string) { super(400, msg, code); } }
export class Unauthorized extends HttpError { constructor(msg = "unauthorized", code?: string) { super(401, msg, code); } }
export class Forbidden    extends HttpError { constructor(msg = "forbidden",    code?: string) { super(403, msg, code); } }
export class NotFound     extends HttpError { constructor(msg = "not found",    code?: string) { super(404, msg, code); } }
export class Conflict     extends HttpError { constructor(msg = "conflict",     code?: string) { super(409, msg, code); } }
export class TooMany      extends HttpError { constructor(msg = "too many",     code?: string) { super(429, msg, code); } }

export function errorResponse(e: unknown): Response {
	if (e instanceof HttpError) {
		return Response.json({ error: e.message, code: e.code }, { status: e.status });
	}
	// Handle errors that carry a numeric `status` property (e.g. ForbiddenError / NotFoundError from rbac.ts)
	if (e instanceof Error && typeof (e as unknown as { status?: unknown }).status === "number") {
		const status = (e as unknown as { status: number }).status;
		return Response.json({ error: e.message }, { status });
	}
	console.error("unhandled error", e);
	return Response.json({ error: "internal" }, { status: 500 });
}
