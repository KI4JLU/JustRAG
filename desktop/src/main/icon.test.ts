import { describe, expect, it } from "vitest";
import { ACCENT, appIconSvg, iconLetter } from "./icon";

describe("iconLetter", () => {
  it("takes the first letter or digit, upper-cased", () => {
    expect(iconLetter("Atlas")).toBe("A");
    expect(iconLetter("  rag ")).toBe("R");
    expect(iconLetter("»österreich«")).toBe("Ö");
    expect(iconLetter("4You")).toBe("4");
  });
  it("falls back to the default name's letter", () => {
    expect(iconLetter("")).toBe("R");
    expect(iconLetter("<&>")).toBe("R");
    expect(iconLetter(undefined)).toBe("R");
    expect(iconLetter({})).toBe("O"); // "[object Object]": still one harmless letter
  });
});

describe("appIconSvg", () => {
  it("draws a full-bleed tile outside macOS", () => {
    const svg = appIconSvg("Atlas", { mac: false });
    expect(svg).toContain(`<rect x="0" y="0" width="512" height="512" rx="96" fill="${ACCENT}"/>`);
    expect(svg).toContain(">A</text>");
  });
  it("insets the tile to Apple's icon grid on macOS", () => {
    const svg = appIconSvg("Atlas", { mac: true });
    expect(svg).toContain(`<rect x="50" y="50" width="412" height="412" rx="92.5"`);
  });
  it("never carries markup from the name", () => {
    expect(appIconSvg("<script>", { mac: false })).toContain(">S</text>");
  });
  it("renders at the requested size", () => {
    expect(appIconSvg("A", { mac: false, size: 1024 })).toContain('width="1024" height="1024" viewBox="0 0 512 512"');
  });
});
