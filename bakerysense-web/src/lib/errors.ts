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
	console.error("unhandled error", e);
	return Response.json({ error: "internal" }, { status: 500 });
}
