/* Face verification: detection, 128-d face descriptors and a head-turn liveness check.
   Runs fully on this server (face-api.js on TensorFlow WASM) — no biometric data leaves the system. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { badRequest } from '../utils/http.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const MODEL_DIR = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
const MAX_SIDE = 640;
const MIN_FACE_PX = 64;

let faceapi = null;
let loading = null;
async function load() {
  if (faceapi) return faceapi;
  loading ??= (async () => {
    const fa = await import('@vladmandic/face-api/dist/face-api.node-wasm.js');
    const api = fa.default ?? fa;
    await api.tf.setBackend('wasm');
    await api.tf.ready();
    await Promise.all([api.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR), api.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR),
      api.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR)]);
    logger.info('face models loaded');
    faceapi = api;
    return api;
  })().catch(err => { loading = null; throw err; });
  return loading;
}

/* Inference is CPU-bound; run one image at a time so concurrent punches cannot exhaust memory. */
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

/** Decodes any supported image, applies EXIF orientation, downsizes and adds a margin (the detector misses
 *  passport-style photos where the face fills the frame). Throws 400 for non-images. */
async function decode(buffer) {
  try {
    const resized = await sharp(buffer, { limitInputPixels: 40e6 }).rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).removeAlpha().png().toBuffer();
    const { width, height } = await sharp(resized).metadata();
    const pad = Math.round(Math.max(width, height) * 0.25);
    const { data, info } = await sharp(resized).extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#808080' })
      .raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw badRequest('The image could not be read — capture the photo again');
  }
}

/** Nose-tip position between the outer eye corners: ~0.5 facing the camera, rises as the head turns to the subject's left. */
function yawRatio(points) {
  const r = points[36], l = points[45], nose = points[30];
  const span = l.x - r.x;
  return span > 0 ? (nose.x - r.x) / span : 0.5;
}

/** Real engine. Tests replace `faceEngine.analyze` the same way they replace `db`. */
export const faceEngine = {
  /** → { faces: number, descriptor: number[] | null, yaw: number | null } for the largest clear face. */
  async analyze(buffer) {
    const img = await decode(buffer);
    const api = await load();
    return serial(async () => {
      const t = api.tf.tensor3d(img.data, [img.height, img.width, 3], 'int32');
      try {
        const found = await api.detectAllFaces(t, new api.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks().withFaceDescriptors();
        const largest = Math.max(0, ...found.map(f => f.detection.box.width));
        if (largest < MIN_FACE_PX) return { faces: 0, descriptor: null, yaw: null };
        // Faces at least half the size of the main one count as other people in the photo.
        const clear = found.filter(f => f.detection.box.width >= largest / 2);
        if (clear.length !== 1) return { faces: clear.length, descriptor: null, yaw: null };
        const f = clear[0];
        return { faces: 1, descriptor: Array.from(f.descriptor), yaw: yawRatio(f.landmarks.positions) };
      } finally { t.dispose(); }
    });
  },
  warmUp: () => load(),
};

export const distance = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

/** Pure decision. direction is the side the employee was asked to turn their head to (their own left/right).
 *  Frames are the raw camera image (not mirrored), so turning to the subject's left moves the nose right in the image. */
export function evaluateVerification({ profile, front, turned, direction, threshold = env.faceMatchThreshold, minTurn = env.faceLivenessMinTurn }) {
  if (front.faces === 0) return { status: 'NO_FACE', message: 'No face detected — face the camera in good light and retake' };
  if (front.faces > 1) return { status: 'MULTIPLE_FACES', message: 'More than one face detected — only you should be in the photo' };
  if (turned.faces !== 1) return { status: 'LIVENESS_FAILED', message: 'Face not detected while turning — keep your face in the frame and retake' };
  const dist = distance(front.descriptor, profile);
  if (dist > threshold) return { status: 'MISMATCH', distance: dist, message: 'Face does not match your registered photo. Attendance cannot be marked.' };
  if (distance(front.descriptor, turned.descriptor) > threshold + 0.1)
    return { status: 'LIVENESS_FAILED', distance: dist, message: 'Both captures must be of the same person — retake' };
  const turn = (turned.yaw - front.yaw) * (direction === 'LEFT' ? 1 : -1);
  if (turn < minTurn)
    return { status: 'LIVENESS_FAILED', distance: dist, message: `Turn your head clearly to your ${direction.toLowerCase()} for the second capture and retake` };
  return { status: 'PASSED', distance: dist, message: 'Face verified successfully' };
}

/* ── Secure storage (outside the public /uploads static route) ──────────────────────────── */
const secureDir = folder => { const d = path.join(env.secureUploadDir, folder); fs.mkdirSync(d, { recursive: true }); return d; };

/** Re-encodes to JPEG (strips EXIF/GPS metadata, fixes orientation) and stores it. Returns a storage key, not a URL. */
export async function storeSecureJpeg(folder, buffer, maxSide = 800) {
  const out = await sharp(buffer, { limitInputPixels: 40e6 }).rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const name = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(secureDir(folder), name), out);
  return `${folder}/${name}`;
}

/** Absolute path for a storage key, refusing anything that escapes the secure directory. */
export function securePath(key) {
  if (!key) return null;
  const p = path.resolve(env.secureUploadDir, key);
  return p.startsWith(env.secureUploadDir + path.sep) && fs.existsSync(p) ? p : null;
}

export function removeSecure(key) {
  const p = securePath(key);
  if (p) fs.rm(p, { force: true }, () => {});
}
