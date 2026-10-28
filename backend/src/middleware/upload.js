import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/http.js';

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' };

function dirFor(folder) {
  const d = path.join(env.uploadDir, folder);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const randomName = ext => `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;

/** Multer instance storing into uploads/<folder> with random, unguessable names. */
export function uploader(folder) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dirFor(folder)),
      filename: (_req, file, cb) => cb(null, randomName(ALLOWED[file.mimetype])),
    }),
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 12 },
    fileFilter: (_req, file, cb) =>
      ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Only JPG, PNG, WEBP, HEIC or PDF files are allowed')),
  });
}

/** Public URL path for a stored file. */
export const publicPath = (folder, file) => (file ? `/uploads/${folder}/${path.basename(file.path ?? file)}` : null);

/** Saves a base64 data-URL image (signature pad) and returns its public path. */
export function saveDataUrl(folder, dataUrl, maxBytes = 512 * 1024) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw badRequest('Signature must be a PNG or JPEG image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw badRequest('Signature image is too large');
  const name = randomName(m[1] === 'png' ? '.png' : '.jpg');
  fs.writeFileSync(path.join(dirFor(folder), name), buf);
  return `/uploads/${folder}/${name}`;
}

export function removeUploaded(files = []) {
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}
