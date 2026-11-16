// The app icon: the first letter of the app's name, white, on the design
// system's default accent colour (design system → Storybook "Native shell" →
// App icon). One drawing, so the icon built into the package and the one set
// while running cannot differ.

// The design system's `--color-primary` in the standard accent, light scheme.
// A host has no CSS tokens to read, so it is restated here.
export const ACCENT = "#0056b3";
export const DEFAULT_NAME = "RAG";

/** "Atlas" → "A", " rag " → "R"; anything without a letter or digit → the default's. */
export function iconLetter(name: unknown): string {
  const first = Array.from(String(name ?? "").trim()).find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return (first ?? DEFAULT_NAME[0]).toLocaleUpperCase("de-DE");
}

/**
 * The drawing, in a 512 square. On macOS the tile is inset to Apple's icon
 * grid (824 of 1024 with a 185 corner radius): the dock draws an icon as it
 * is, and a full-bleed tile sits larger than every neighbour. Elsewhere the
 * tile is full-bleed with the 96 radius JLU Campus uses.
 */
export function appIconSvg(name: unknown, { mac, size = 512 }: { mac: boolean; size?: number }): string {
  // `iconLetter` only lets a letter or digit through, so nothing needs escaping.
  const letter = iconLetter(name);
  const inset = mac ? 50 : 0;
  const tile = 512 - 2 * inset;
  const scale = tile / 512;
  const radius = mac ? 92.5 : 96;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">` +
    `<rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${radius}" fill="${ACCENT}"/>` +
    `<text x="256" y="${inset + 350 * scale}" fill="white" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="${300 * scale}" font-weight="bold" text-anchor="middle">${letter}</text>` +
    `</svg>`
  );
}
