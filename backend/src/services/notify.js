import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Inserts an in-app notification. Accepts an optional transaction. */
export function notify(userId, { icon, title, body, tone = 'blue', link = null }, tx) {
  if (!userId) return Promise.resolve();
  return db.query(
    `INSERT dbo.Notifications (UserId, Icon, Title, Body, Tone, Link) VALUES (@userId, @icon, @title, @body, @tone, @link)`,
    { userId, icon, title, body, tone, link }, tx);
}

export async function managerOf(userId, tx) {
  const r = await db.one('SELECT ManagerId FROM dbo.Users WHERE UserId = @userId', { userId }, tx);
  return r?.ManagerId ?? null;
}

/** Sends an OTP over SMS + WhatsApp through the configured gateway; logs it when no gateway is set. */
export async function sendOtp(mobile, otp) {
  if (!env.smsGatewayUrl) {
    logger.info({ mobile: mobile.replace(/\d(?=\d{3})/g, '•') }, 'OTP generated (no SMS gateway configured)');
    return;
  }
  const res = await fetch(env.smsGatewayUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.smsGatewayToken}` },
    body: JSON.stringify({ to: mobile, channels: ['sms', 'whatsapp'], message: `Your Marketing Management login OTP is ${otp}. Valid for ${Math.round(env.otpTtlSeconds / 60)} minutes.` }),
  });
  if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
}
