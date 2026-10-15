/**
 * The calendar page in three languages: every text exists in English, Italian
 * and Spanish, none is empty, the placeholders match, and every key the page
 * uses is in the dictionary. A missing translation fails here at once.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderPage } from "../src/page.js";
import { PAGE_TEXTS } from "../src/page-texts.js";
import { loadHostConfig } from "../src/config.js";
import { pricesPayload } from "../src/serve.js";
import { tempDir } from "./helpers.js";

const LANGS = ["en", "it", "es"] as const;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const html = renderPage("nonce-0000");
const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";

describe("AirROI on the calendar page", () => {
  /** Runs the page's own helpers with a tiny stand-in for the DOM. */
  function render(text: string) {
    type Node = { tag: string; className?: string; textContent?: string; href?: string; target?: string; rel?: string; children: (Node | string)[]; append(...n: (Node | string)[]): void };
    const document = {
      createElement: (tag: string): Node => {
        const node: Node = { tag, children: [], append: (...n) => node.children.push(...n) };
        return node;
      },
    };
    const helpers = script.slice(script.indexOf("const el ="), script.indexOf("const LANGS"));
    const fn = new Script(`${helpers}; withSourceLinks("div", "note", TEXT)`);
    return fn.runInNewContext({ document, TEXT: text }) as Node;
  }

  it("turns every Powered by AirROI into a link to airroi.com, and leaves the rest as text", () => {
    const node = render("zone 90% booked vs 70% average · Powered by AirROI (https://www.airroi.com) · read 2026-11-01");
    expect(node.children).toHaveLength(3);
    expect(node.children[0]).toBe("zone 90% booked vs 70% average · ");
    expect(node.children[1]).toMatchObject({ tag: "a", textContent: "Powered by AirROI", href: "https://www.airroi.com", target: "_blank", rel: "noopener noreferrer" });
    expect(node.children[2]).toBe(" · read 2026-11-01");
    expect(render("Source: your file").children).toEqual(["Source: your file"]);
  });
});

describe("texts of the calendar page", () => {
  it("arrives already in the folder's language: tab title, html lang and the first texts", () => {
    const italian = renderPage("nonce-0000", "it");
    expect(italian).toContain('<html lang="it">');
    expect(italian).toContain(`<title>${PAGE_TEXTS.it.page_title}</title>`);
    expect(italian).toContain('const START_LANG = "it";');
    expect(renderPage("nonce-0000", "es")).toContain(`<title>${PAGE_TEXTS.es.page_title}</title>`);
    expect(html).toContain('<html lang="en">');
  });

  it("has the same keys in English, Italian and Spanish, none empty", () => {
    const keys = Object.keys(PAGE_TEXTS.en).sort();
    for (const lang of LANGS) {
      expect(Object.keys(PAGE_TEXTS[lang]).sort(), lang).toEqual(keys);
      for (const [key, text] of Object.entries(PAGE_TEXTS[lang])) expect(text.trim(), `${lang}.${key}`).not.toBe("");
    }
  });

  it("keeps the placeholders of each text; a singular may say the number in words", () => {
    for (const [key, text] of Object.entries(PAGE_TEXTS.en)) {
      const wanted = placeholders(text);
      for (const lang of ["it", "es"] as const) {
        const got = placeholders(PAGE_TEXTS[lang][key as keyof typeof PAGE_TEXTS.en]);
        if (key.endsWith("_one")) expect(wanted, `${lang}.${key}`).toEqual(expect.arrayContaining(got));
        else expect(got, `${lang}.${key}`).toEqual(wanted);
      }
    }
  });

  it("has both forms of every plural", () => {
    for (const key of Object.keys(PAGE_TEXTS.en)) {
      if (key.endsWith("_one")) expect(Object.keys(PAGE_TEXTS.en), key).toContain(key.replace(/_one$/, "_other"));
      if (key.endsWith("_other")) expect(Object.keys(PAGE_TEXTS.en), key).toContain(key.replace(/_other$/, "_one"));
    }
  });

  it("has every key the page asks for", () => {
    const keys = new Set(Object.keys(PAGE_TEXTS.en));
    const used = [
      // Whole keys only: t("min_" + code) is a prefix, listed below.
      ...[...script.matchAll(/\bt\("(\w+)"[,)]/g)].map((m) => m[1] as string),
      ...[...script.matchAll(/\btn\("(\w+)"[,)]/g)].flatMap((m) => [`${m[1]}_one`, `${m[1]}_other`]),
      ...[...html.matchAll(/data-t(?:-label)?="(\w+)"/g)].map((m) => m[1] as string),
      // The minimum-stay reasons, by the engine's codes.
      ...["override", "farOut", "lastMinute", "default", "gap"].map((s) => `min_${s}`),
    ];
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((k) => !keys.has(k))).toEqual([]);
  });

  it("puts the texts in the page as data, valid JavaScript, nothing that closes the script", () => {
    expect(() => new Script(script)).not.toThrow();
    expect(script.indexOf("</")).toBe(-1);
    expect(html).toContain('<option value="it">IT</option>');
  });

  it("sounds like a host, not like a translation: a few texts as written", () => {
    expect(PAGE_TEXTS.it.recalculate).toBe("Aggiorna i prezzi");
    expect(PAGE_TEXTS.es.legend_hint).toBe("pulsa en una noche para ver por qué tiene ese precio");
    expect(PAGE_TEXTS.it.raw_summary).toBe("Testo completo (in inglese)");
    expect(PAGE_TEXTS.es.raw_summary).toBe("Texto completo (en inglés)");
  });
});

describe("language of the page", () => {
  const folder = (language?: string) => {
    const dir = tempDir();
    const config = { ...(language ? { language } : {}), listings: [{ name: "casa", calendars: [], pricing: { currency: "EUR", basePrice: 90, defaultMinStay: 2, factors: {} } }] };
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(config));
    return dir;
  };

  it("comes from the config, and is English when the config has none", () => {
    const it_ = folder("it");
    expect(pricesPayload(it_, loadHostConfig(it_), "2026-11-02", 3).language).toBe("it");
    const none = folder();
    expect(pricesPayload(none, loadHostConfig(none), "2026-11-02", 3).language).toBe("en");
  });

  it("the steps of a night reach the page with their facts (params)", () => {
    const dir = tempDir();
    const pricing = { currency: "EUR", basePrice: 90, defaultMinStay: 2, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 200 } } };
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ language: "es", listings: [{ name: "casa", calendars: [], pricing }] }));
    const night = pricesPayload(dir, loadHostConfig(dir), "2026-11-02", 1).listings[0]?.nights[0];
    expect(night?.steps.at(-1)).toMatchObject({ factor: "limits", params: { kind: "within", floor: 60, ceiling: 200 } });
  });
});
