/** Approximate guardrails for request bodies and CSV payloads (DoS / memory). */

export const MAX_CSV_TEXT_CHARS = 15_000_000;

export const MAX_GENERATION_GUESTS = 10_000;

export const MAX_PROJECT_GUESTS = MAX_GENERATION_GUESTS;

export const MAX_DATA_URL_CHARS = 25_000_000;

export const MAX_EVENT_NAME_CHARS = 500;

/** Venue line + date line on signage PDFs. */
export const MAX_SIGNAGE_VENUE_LABEL_CHARS = 200;
export const MAX_SIGNAGE_EVENT_DATE_CHARS = 120;

export const MAX_STOCK_NAME_CHARS = 2000;

/** Floorplan grid dimensions (rows × columns). */
export const MAX_FLOORPLAN_GRID = 24;

/** Buffet menu generator */
export const MAX_BUFFET_MENU_ITEMS = 200;
export const MAX_BUFFET_CATEGORY_TITLE_CHARS = 120;
export const MAX_BUFFET_ITEM_TITLE_CHARS = 500;
export const MAX_BUFFET_SAVED_NAME_CHARS = 200;
export const MAX_BUFFET_CATEGORIES = 50;
