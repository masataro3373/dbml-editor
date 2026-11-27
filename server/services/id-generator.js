// 日本語コメント: サーバー用暗号論的 ShortID ジェネレータ (Base62 10桁・プレフィックスなし)
import crypto from 'node:crypto';

export function generateShortId(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function isValidShortId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{10}$/.test(id);
}
