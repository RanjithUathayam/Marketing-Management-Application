import { ZodError } from 'zod';
import multer from 'multer';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, `Route ${req.method} ${req.path} not found`));
}

/* Maps known error shapes to HTTP responses. Unknown errors become 500 without leaking details. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const details = err.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: details[0]?.message ?? 'Invalid input', details });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message });
  }
  if (err?.problems) return res.status(400).json({ error: err.message, details: err.problems });
  // THROW 50000–50999 from stored procedures carries a user-facing message
  if (err?.number >= 50000 && err?.number < 51000) return res.status(400).json({ error: err.message });
  if (err?.number === 2627 || err?.number === 2601) return res.status(409).json({ error: 'This record already exists' });
  if (err?.number === 547) return res.status(400).json({ error: 'The request references data that does not exist or is still in use' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  // Express / body-parser / serve-static client errors (malformed JSON, missing upload file, …)
  if (err?.status >= 400 && err.status < 500)
    return res.status(err.status).json({ error: err.status === 404 ? 'Not found' : err.expose ? err.message : 'Bad request' });

  logger.error({ err, path: req.path, user: req.user?.id }, 'unhandled error');
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
