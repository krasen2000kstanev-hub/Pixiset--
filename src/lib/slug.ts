import { customAlphabet } from "nanoid";

const suffix = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 6);

const CYRILLIC: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d",
  "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
  "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
  "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
  "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh",
  "щ": "sht", "ъ": "a", "ь": "", "ю": "yu", "я": "ya",
  "ё": "e",
};

/** Turn a title into a URL-safe slug base (transliterates common Cyrillic). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => CYRILLIC[ch] ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

/** A slug that is very unlikely to collide, e.g. "smith-wedding-k7m2p9". */
export function uniqueSlug(title: string): string {
  const base = slugify(title) || "gallery";
  return `${base}-${suffix()}`;
}

export function randomToken(size = 21): string {
  return customAlphabet(
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    size,
  )();
}
