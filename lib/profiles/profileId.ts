const SAFE_PROFILE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function isSafeProfileId(id: string): boolean {
  return SAFE_PROFILE_ID_RE.test(id);
}

/**
 * Profile IDs are used as filesystem filenames (local store) and R2 object keys.
 * Reject path separators and other unsafe characters.
 */
export function assertSafeProfileId(id: string): void {
  if (!isSafeProfileId(id)) {
    throw new Error("Invalid profile id. Use letters, numbers, underscores, or hyphens (1–128 characters).");
  }
}
