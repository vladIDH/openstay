/**
 * The check-in link from the host's side: the box on the relay, the download,
 * the guests opened only with the passphrase. The relay is a fake in memory
 * with the same API as fairguest-relay; the "guest" seals with the same
 * webSeal the browser page uses. Invented data only.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { padded, readLinkFragment, relayPlace, webSeal } from "fairguest";
import { openDb } from "../src/db.js";
import type { RelayFetchLike } from "../src/io.js";
import { main } from "../src/main.js";
import { PAGE_HASHES } from "../src/guests/page-hashes.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

const NOW = "2099-06-01T09:00:00";
const PASS = "frase segreta di prova";
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const ICAL = "https://cal.example.org/airbnb/casa-prova.ics";
const RELAY = "https://relay.example.invalid";

const opened: { close(): void; open: boolean }[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) if (d.open) d.close();
});

/** A relay in memory: boxes with hashed secrets, like fairguest-relay. */
function fakeRelay() {
  const boxes = new Map<string, { read: string; write: string; expires: string; messages: { id: string; body: string }[] }>();
  const files = new Map<string, Buffer>();
  const redirects = new Map<string, string>();
  const calls: string[] = [];
  let next = 0;
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const answer = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
  const fetchFn: RelayFetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.pathname}`);
    const m = /^\/api\/box\/([^/]+)(\/messages(?:\/([^/]+))?)?$/.exec(u.pathname);
    if (!m) {
      if (redirects.has(u.pathname)) return { status: 307, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers({ location: redirects.get(u.pathname) as string }) };
      const f = files.get(u.pathname);
      return f ? { status: 200, text: async () => f.toString(), arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.length) as ArrayBuffer } : answer(404, {});
    }
    const read = (init.headers.authorization ?? "").replace("Bearer ", "");
    const box = boxes.get(m[1] as string);
    if (init.method === "PUT" && !m[2]) {
      const b = JSON.parse(init.body ?? "{}") as { writeHash: string; expires: string };
      boxes.set(m[1] as string, { read: sha(read), write: b.writeHash, expires: b.expires, messages: [] });
      return answer(201, {});
    }
    if (!box) return answer(404, {});
    if (sha(read) !== box.read) return answer(403, {});
    if (init.method === "GET") return answer(200, { messages: box.messages });
    if (init.method === "DELETE" && m[3]) {
      box.messages = box.messages.filter((x) => x.id !== m[3]);
      return answer(200, { deleted: 1 });
    }
    if (init.method === "DELETE") {
      boxes.delete(m[1] as string);
      return answer(200, { deleted: true });
    }
    return answer(405, {});
  };
  /** What the guest's page does: seal with the key in the link, post with the write secret. */
  const guestPosts = async (link: string, message: unknown) => {
    const box = /\/c\/([^#]+)#/.exec(link)?.[1] as string;
    const payload = readLinkFragment(link.slice(link.indexOf("#"))) as NonNullable<ReturnType<typeof readLinkFragment>>;
    const b = boxes.get(box);
    if (!b || sha(payload.w) !== b.write) throw new Error("wrong write secret");
    b.messages.push({ id: `m${next++}`, body: await webSeal(payload.k, padded(message as object), relayPlace(box)) });
    return payload;
  };
  return { fetchFn, boxes, files, redirects, calls, guestPosts };
}

const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nBEGIN:VEVENT\r\nDTEND;VALUE=DATE:20990613\r\nDTSTART;VALUE=DATE:20990610\r\nUID:prova-1@airbnb.example\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

async function ready(country: "ES-CT" | "IT" = "ES-CT") {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify({
      fairguestRelay: RELAY,
      listings: [
        {
          name: "casa-prova",
          calendars: [{ source: "airbnb", url: ICAL }],
          pricing: { name: "Casa di Prova", currency: "EUR", basePrice: 100, defaultMinStay: 1, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 } } },
          fairguest: { country, establishment: "ZZ00000000", establishmentName: "Casa di Prova", checkInTime: "16:00", checkOutTime: "10:00" },
        },
      ],
    }),
  );
  const relay = fakeRelay();
  const io = (extra: Partial<TestIo> = {}, now = NOW) => Object.assign(testIo(dir, fakeFetch({ [ICAL]: ics }), now), { scryptCost: FAST, env: { FAIRGUEST_FRASE: PASS }, relayFetch: relay.fetchFn, ...extra });
  expect(await main(["ospiti", "attiva"], io())).toBe(0);
  expect(await main(["sync"], io())).toBe(0);
  const db = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(db);
  const stay = db.prepare("SELECT id FROM guest_stays").get() as { id: string };
  return { dir, relay, io, db, stay };
}

const GUEST = {
  givenName: "Ospite",
  surname1: "Prova",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  document: { type: "passport", number: "ZZ0000000" },
  address: { country: "ITA", street: "Via di Prova 1", locality: "Città di Prova" },
  email: "ospite.prova@example.com",
};

describe("fairnight ospiti link", () => {
  it("creates the box with only a read secret and the hash of the write secret, and puts the rest after #", async () => {
    const { relay, io, db, stay } = await ready();
    const t = io();
    expect(await main(["ospiti", "link", stay.id], t)).toBe(0);
    const url = t.lines[0] as string;
    expect(url.startsWith(`${RELAY}/c/`)).toBe(true);
    const payload = readLinkFragment(url.slice(url.indexOf("#")));
    expect(payload).toMatchObject({ c: "ES-CT", n: "Casa di Prova", i: "2099-06-10", o: "2099-06-13" });
    const [box] = [...relay.boxes.values()];
    expect(box?.expires).toBe("2099-06-15T12:00:00Z");
    // The relay never saw the write secret, the key or the stay.
    expect(JSON.stringify(box)).not.toContain(payload?.w as string);
    expect(relay.calls).toEqual([`PUT /api/box/${/\/c\/([^#]+)/.exec(url)?.[1]}`]);
    // The same link again, no second box.
    const again = io();
    expect(await main(["ospiti", "link", stay.id], again)).toBe(0);
    expect(again.lines[0]).toBe(url);
    expect(relay.boxes.size).toBe(1);
    expect(db.prepare("SELECT relay_box IS NOT NULL AS has FROM guest_stays").get()).toEqual({ has: 1 });
  });

  it("downloads what the guest sealed, deletes it from the relay, and opens it only with the passphrase", async () => {
    const { relay, io, db, stay } = await ready();
    const t = io();
    await main(["ospiti", "link", stay.id], t);
    await relay.guestPosts(t.lines[0] as string, { guest: { ...GUEST, iban: "never kept" }, payment: "platform" });
    const pull = io({ env: {} });
    expect(await main(["ospiti", "scarica"], pull)).toBe(0);
    expect(pull.lines.join("\n")).toMatch(/Downloaded 1 guest/);
    expect([...relay.boxes.values()][0]?.messages).toEqual([]);
    const row = db.prepare("SELECT added_by, data, place FROM guest_people").get() as { added_by: string; data: string; place: string };
    expect(row.added_by).toBe("form");
    expect(row.data.startsWith("fg1.")).toBe(true);
    expect(row.data).not.toContain("Ospite");
    expect(row.place.startsWith("relay/")).toBe(true);
    const show = io();
    expect(await main(["ospiti", "mostra", stay.id], show)).toBe(0);
    expect(show.lines.join("\n")).toContain("1. Ospite Prova");
    const exported = io();
    await main(["ospiti", "esporta", stay.id], exported);
    expect(exported.lines.join("\n")).not.toContain("never kept");
    expect(exported.lines.join("\n")).not.toContain("_pad");
  });

  it("is checked against the same rules as the local form when the stay is prepared", async () => {
    const { relay, io, stay } = await ready();
    const t = io();
    await main(["ospiti", "link", stay.id], t);
    await relay.guestPosts(t.lines[0] as string, { guest: { givenName: "Ospite", surname1: "Prova", birthDate: "not a date" } });
    await main(["ospiti", "scarica"], io());
    const show = io();
    expect(await main(["ospiti", "mostra", stay.id], show)).toBe(0);
    expect(show.lines.join("\n")).toMatch(/guests\[0\]\.birthDate: the date of birth is required/);
  });

  it("Catalonia: a guest from the link goes into the Mossos file like any other", async () => {
    const { relay, io, stay } = await ready("ES-CT");
    const t = io();
    await main(["ospiti", "link", stay.id], t);
    await relay.guestPosts(t.lines[0] as string, {
      guest: {
        givenName: "Ospite",
        surname1: "Prueba",
        surname2: "Ejemplo",
        birthDate: "2060-03-15",
        sex: "female",
        nationality: "ESP",
        document: { type: "dni", number: "00000000T", support: "ZZZ000000" },
        address: { country: "ESP", street: "Calle de Prueba 1", postalCode: "08000", municipalityCode: "080000" },
        email: "ospite.prova@example.com",
      },
      payment: "platform",
    });
    await main(["ospiti", "scarica"], io());
    const prep = io();
    expect(await main(["ospiti", "prepara", stay.id, "--out", "."], prep)).toBe(0);
    const file = /Wrote (.+): 1 traveller line/.exec(prep.lines.join(String.fromCharCode(10)))?.[1] as string;
    expect(readFileSync(file, "latin1").split(String.fromCharCode(13, 10))[1]).toMatch(/^2\|00000000T\|\|D\|\|PRUEBA\|EJEMPLO\|OSPITE\|F\|/);
  });

  it("deletes the box once the stay is over", async () => {
    const { relay, io, db, stay } = await ready();
    await main(["ospiti", "link", stay.id], io());
    const later = io({}, "2099-06-20T09:00:00");
    expect(await main(["ospiti", "scarica"], later)).toBe(0);
    expect(relay.boxes.size).toBe(0);
    expect(db.prepare("SELECT relay_box FROM guest_stays").get()).toEqual({ relay_box: null });
  });

  it("reminds that in Italy the link does not replace the recognition", async () => {
    const { io, stay } = await ready("IT");
    const t = io();
    expect(await main(["ospiti", "link", stay.id], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/does not replace recognizing the guests/);
  });
});

describe("fairnight ospiti verifica-pagina", () => {
  it("says when the relay serves exactly this page, and which file differs otherwise", async () => {
    const { relay, io } = await ready();
    // A relay serving files whose hashes are exactly those expected: build them backwards is impossible,
    // so the test checks the report with one wrong file and every other one missing.
    relay.files.set("/app.js", Buffer.from("changed"));
    const t = io();
    expect(await main(["ospiti", "verifica-pagina"], t)).toBe(1);
    expect(t.lines).toContain(`DIFFERENT  /app.js  (sha256 ${createHash("sha256").update("changed").digest("hex")})`);
    expect(t.lines).toContain("DIFFERENT  /checkin.html  (not served)");
    // The page is asked where the relay serves it, at /c/<box>.
    expect(relay.calls).toContain(`GET /c/${"0".repeat(22)}`);
    expect(Object.keys(PAGE_HASHES)).toEqual(expect.arrayContaining(["/app.js", "/app.css", "/checkin.html", "/ocr/worker.min.js"]));
  });

  it("does not follow a redirect of the page: the phone would leave /c/<box> and lose the box", async () => {
    const { relay, io } = await ready();
    relay.redirects.set(`/c/${"0".repeat(22)}`, "/checkin");
    const t = io();
    expect(await main(["ospiti", "verifica-pagina"], t)).toBe(1);
    expect(t.lines).toContain("DIFFERENT  /checkin.html  (redirect, HTTP 307 to /checkin: the link would lose its box)");
  });
});
