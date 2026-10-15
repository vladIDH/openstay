import { describe, expect, it } from "vitest";
import { matchName, normaliseName, type Candidate } from "../src/index.js";

const LISTINGS: Candidate[] = [
  { id: "seaview-loft", names: ["seaview-loft", "Seaview Loft by the Harbour"] },
  { id: "garden-studio", names: ["garden-studio", "Quiet Garden Studio"] },
  { id: "tower-a", names: ["Old Tower Rooms"], keywords: ["terrace"] },
  { id: "tower-b", names: ["Old Tower Rooms"], keywords: ["courtyard"] },
];

describe("matchName", () => {
  it("finds the listing by its words, ignoring the common ones", () => {
    expect(matchName("Stunning Apartment Seaview Loft Harbour", LISTINGS)).toEqual({ id: "seaview-loft", name: "Seaview Loft by the Harbour", ambiguous: false, candidates: [] });
    expect(matchName("Garden studio, quiet", LISTINGS).id).toBe("garden-studio");
  });

  it("matches nothing below the threshold, or with no name", () => {
    expect(matchName("Mountain Chalet", LISTINGS).id).toBeNull();
    expect(matchName(null, LISTINGS).id).toBeNull();
  });

  it("never guesses between two units of one channel listing", () => {
    const m = matchName("Old Tower Rooms", LISTINGS);
    expect(m.ambiguous).toBe(true);
    expect(m.candidates).toEqual(["tower-a", "tower-b"]);
    expect(matchName("Old Tower Rooms", LISTINGS, { hint: "Double room with terrace" }).id).toBe("tower-a");
  });

  it("uses an alias set by the host when the words are not enough", () => {
    expect(matchName("Old Tower Rooms", LISTINGS, { aliases: { "old tower rooms": "tower-b" } }).id).toBe("tower-b");
    expect(matchName("Casa Lontana", LISTINGS, { aliases: { "casa lontana": "garden-studio" } }).id).toBe("garden-studio");
    expect(matchName("Casa Lontana", LISTINGS, { aliases: { "casa lontana": "missing" } }).id).toBeNull();
  });

  it("normalises accents and punctuation", () => {
    expect(normaliseName("  Ático—Mar, Céntrico!  ")).toBe("atico mar centrico");
  });
});
