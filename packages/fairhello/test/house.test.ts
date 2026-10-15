import { describe, expect, it } from "vitest";
import { houseText, isCodesHeading, parseHouse } from "../src/index.js";

const HOUSE = `# Seaview Loft

<!-- notes for the host only: the cleaner comes on Fridays -->
A loft by the sea, invented for the tests.

## Check-in
From 16:00. The key box is by the door.

## Wifi
Network "Loft-Guest". The password is on the router.

## Codici d'accesso
Key box: 4471

## Parking
Free in the street.
`;

describe("parseHouse", () => {
  it("reads the title, the sections and keeps the codes apart", () => {
    const h = parseHouse(HOUSE);
    expect(h.title).toBe("Seaview Loft");
    expect(h.sections.map((s) => s.heading)).toEqual(["", "Check-in", "Wifi", "Parking"]);
    expect(h.codes).toBe("Key box: 4471");
    expect(h.warnings).toEqual([]);
    const text = houseText(h);
    expect(text).not.toContain("4471");
    expect(text).not.toContain("cleaner");
    expect(text).toContain("## Wifi");
  });

  it("drops a byte-order mark and Windows line ends", () => {
    const h = parseHouse(String.fromCharCode(0xfeff) + "# Casa\r\n## Wifi\r\nRete Casa\r\n");
    expect(h.title).toBe("Casa");
    expect(h.sections).toEqual([{ heading: "Wifi", text: "Rete Casa" }]);
  });

  it("warns about prices, an empty file and two code sections", () => {
    const h = parseHouse("## Extras\nCot 10 € per night\n## Codes\n1\n## Access codes\n2\n");
    expect(h.warnings).toEqual([{ kind: "codes-twice" }, { kind: "prices", heading: "Extras", found: ["10 €"] }]);
    expect(h.codes).toBe("1\n2");
    expect(parseHouse("<!-- nothing yet -->\n").warnings).toEqual([{ kind: "empty" }]);
  });

  it("knows the code headings in Italian, Spanish and English", () => {
    for (const h of ["Codici", "Codici d'accesso", "Códigos de acceso", "Access codes", "Door code", "CODES"]) expect(isCodesHeading(h)).toBe(true);
    for (const h of ["Check-in", "Codes of conduct", "Wifi", "Codice fiscale"]) expect(isCodesHeading(h)).toBe(false);
  });
});
