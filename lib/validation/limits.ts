/** Approximate guardrails for request bodies and CSV payloads (DoS / memory). */

export const MAX_CSV_TEXT_CHARS = 15_000_000;

export const MAX_GENERATION_GUESTS = 10_000;

export const MAX_PROJECT_GUESTS = MAX_GENERATION_GUESTS;

export const MAX_DATA_URL_CHARS = 25_000_000;

export const MAX_EVENT_NAME_CHARS = 500;

export const MAX_STOCK_NAME_CHARS = 2000;
