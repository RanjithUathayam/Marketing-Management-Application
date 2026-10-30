/* Test harness: real Express app + a scripted stand-in for the `db` object. */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-config-check';
process.env.OTP_DEV_ECHO = 'true';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || 'test-uploads';
process.env.SECURE_UPLOAD_DIR = process.env.SECURE_UPLOAD_DIR || 'test-secure-uploads';

const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { signAccessToken } = await import('../src/middleware/auth.js');

export const app = createApp();
export const calls = [];
let handlers = [];

/** handlers: [[regex, (params) => rows | recordsets]]. First match wins; unmatched SQL returns []. */
export function mockDb(list) {
  handlers = list;
  calls.length = 0;
}
const run = (text, params) => {
  calls.push({ text, params });
  const h = handlers.find(([re]) => re.test(text));
  return h ? h[1](params ?? {}) : [];
};
db.query = async (text, params) => run(text, params);
db.one = async (text, params) => (await db.query(text, params))[0] ?? null;
db.queryMulti = async (text, params) => run(text, params);
db.exec = async (proc, params) => run(proc, params);
db.transaction = async fn => fn({});
db.ping = async () => true;

export const token = (user = {}) =>
  'Bearer ' + signAccessToken({ id: 3, role: 'EXEC', empCode: 'FA-2231', name: 'Ravi Kumar', ...user });
export const EXEC = token();
export const MANAGER = token({ id: 2, role: 'MANAGER', empCode: 'MGR-1001', name: 'Priya K.' });
export const ADMIN = token({ id: 1, role: 'ADMIN', empCode: 'ADM-0001', name: 'Admin' });
