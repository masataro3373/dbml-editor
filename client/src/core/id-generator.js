// 日本語コメント: クライアント用暗号論的 ShortID ジェネレータ (Base62 10桁・プレフィックスなし)
export function generateShortId(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function isValidShortId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{10}$/.test(id);
}
