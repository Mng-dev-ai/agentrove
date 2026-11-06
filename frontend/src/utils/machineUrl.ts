const PAIR_HASH_PREFIX = '#pair=';

export function normalizeHttpsOrigin(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    return null;
  }
  return parsed.origin;
}

export function hostOf(origin: string): string {
  return new URL(origin).host;
}

export type ParsedPairingLink =
  | { ok: true; origin: string; secret: string }
  | { ok: false; reason: 'invalid' | 'not_https' };

export function parsePairingLink(raw: string): ParsedPairingLink {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  const origin = normalizeHttpsOrigin(parsed.href);
  if (!origin || !parsed.hash.startsWith(PAIR_HASH_PREFIX)) return { ok: false, reason: 'invalid' };
  let secret: string;
  try {
    secret = decodeURIComponent(parsed.hash.slice(PAIR_HASH_PREFIX.length));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!/^[\x21-\x7e]{1,512}$/.test(secret)) return { ok: false, reason: 'invalid' };
  return { ok: true, origin, secret };
}

export function buildPairingLink(origin: string, secret: string): string {
  return `${origin}/${PAIR_HASH_PREFIX}${encodeURIComponent(secret)}`;
}

export function isPairingHash(hash: string): boolean {
  return hash.startsWith(PAIR_HASH_PREFIX);
}
