import type { GuestRecord } from "@/types";

/** Words that belong to the surname that follows them: "van der Berg", "de la Cruz", "St John". */
const SURNAME_PARTICLES = new Set([
  "van", "von", "der", "den", "de", "del", "della", "di", "da", "dos", "das", "du", "la", "le",
  "bin", "ibn", "al", "el", "st", "st.", "ter", "ten", "te", "af", "av", "zu", "y"
]);

/** Trailing words that are not the surname: "John Smith Jr". */
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "jnr", "snr"]);

export interface SplitName {
  /** Everything before the surname (title and given names), plus any suffix. */
  given: string;
  surname: string;
}

/**
 * Best-effort split of a full name into given names and surname. The surname is the last word,
 * together with any particles in front of it ("van der Berg"); suffixes such as "Jr" stay with the
 * given names. A one-word name is treated as a surname.
 */
export function splitFullName(fullName: string): SplitName {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { given: "", surname: words[0] ?? "" };

  let end = words.length;
  while (end > 1 && NAME_SUFFIXES.has(words[end - 1].toLowerCase())) end -= 1;
  const suffix = words.slice(end);

  let start = end - 1;
  // Pull particles into the surname, but always leave at least one word as the given name.
  while (start > 1 && SURNAME_PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;

  return {
    given: [...words.slice(0, start), ...suffix].join(" "),
    surname: words.slice(start, end).join(" ")
  };
}

/**
 * Surname and given names for a guest. A surname from the guest list's "last name" column, or one
 * typed in Last-minute edits, always wins over the guess.
 */
export function guestNameParts(guest: Pick<GuestRecord, "name" | "lastName">): SplitName {
  const explicit = guest.lastName?.trim();
  if (!explicit) return splitFullName(guest.name);
  const name = guest.name.trim();
  const lowerName = name.toLowerCase();
  const lowerSurname = explicit.toLowerCase();
  const at = lowerName.lastIndexOf(lowerSurname);
  if (at < 0) return { given: name, surname: explicit };
  const given = `${name.slice(0, at)} ${name.slice(at + explicit.length)}`.replace(/\s+/g, " ").trim();
  return { given, surname: explicit };
}

/** "Fortescue, Sir Reginald" — the surname leads so it is what the eye finds. */
export function surnameFirst(parts: SplitName): string {
  if (!parts.given) return parts.surname;
  if (!parts.surname) return parts.given;
  return `${parts.surname}, ${parts.given}`;
}

/** The A–Z heading a surname files under ("É" → "E"); anything else goes under "#". */
export function indexLetter(surname: string): string {
  const first = surname.trim().normalize("NFD").replace(/\p{M}+/gu, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}
