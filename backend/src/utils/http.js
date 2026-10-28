export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, msg);
export const conflict = msg => new HttpError(409, msg);

/** Standard paging params from the query string. */
export function paging(q, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(q.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const paged = (items, total, { page, pageSize }) => ({ items, total, page, pageSize });
