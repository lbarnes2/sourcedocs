/**
 * Signed session cookie. Uses Web Crypto only, so it runs in middleware (edge) and route handlers alike.
 * Cookie value: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, AUTH_SECRET)).
 */
import { isRole, type Role } from "@/lib/auth/roles";

export const SESSION_COOKIE = "ec_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  uid: string;
  name: string;
  role: Role;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let keyPromise: Promise<CryptoKey> | null = null;
let keySecret: string | null = null;

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is not set (needs at least 32 characters).");
  }
  return secret;
}

function hmacKey(): Promise<CryptoKey> {
  const secret = authSecret();
  if (!keyPromise || keySecret !== secret) {
    keySecret = secret;
    keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return keyPromise;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function signSession(payload: Omit<SessionPayload, "exp">): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS };
  const body = toBase64Url(encoder.encode(JSON.stringify(full)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body)));
  return `${body}.${toBase64Url(sig)}`;
}

/** Returns the payload when the cookie is authentic and unexpired, otherwise null. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromBase64Url(token.slice(dot + 1)),
      encoder.encode(body)
    );
    if (!ok) return null;
    const parsed = JSON.parse(decoder.decode(fromBase64Url(body))) as Partial<SessionPayload>;
    if (typeof parsed.uid !== "string" || typeof parsed.name !== "string" || !isRole(parsed.role)) return null;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 <= Date.now()) return null;
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}
