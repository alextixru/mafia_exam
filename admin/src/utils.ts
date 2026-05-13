export const genId = (prefix = "q"): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

// Карта простой транслитерации (без претензий на ISO 9 — нужно только
// чтобы получить ASCII-slug для имени файла).
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export const slugify = (s: string): string => {
  const transliterated = s
    .toLowerCase()
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("");
  const slug = transliterated
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug;
};

/**
 * Slug из строки + suffix-разрешение коллизий через taken-set.
 * Если slug пуст или занят — добавляем "_<random>" в конец.
 */
export const slugifyUnique = (
  title: string,
  taken: Iterable<string>,
  prefix = "poll",
): string => {
  const base = slugify(title) || prefix;
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
};

export function classNames(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
