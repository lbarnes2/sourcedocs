/**
 * Client helper: extracts an error message from a failed fetch response without throwing on
 * non-JSON bodies (e.g. a platform 413 "Request Entity Too Large" HTML page).
 */
export async function readResponseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // not JSON
  }
  if (response.status === 413) return "The request was too large for the server. Try smaller logo images.";
  return `${fallback} (HTTP ${response.status})`;
}
