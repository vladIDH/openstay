import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeBeds24, TEST_INVITE, TEST_REFRESH, type FakeBeds24 } from "../../fairnight-beds24/test/fake-beds24.js";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeSmoobu } from "../../fairnight-smoobu/test/fake-smoobu.js";
import { loadBeds24Credentials, saveBeds24Credentials, saveBeds24Token } from "../src/beds24-credentials.js";
import { addDays } from "../src/channel.js";
import { keyTexts } from "../src/chiavi-testi.js";
import { loadCredentials, saveCredentials } from "../src/credentials.js";
import { openDb } from "../src/db.js";
import type { Io } from "../src/io.js";
import { main } from "../src/main.js";
import { activeConfirmations } from "../src/pilota-conferme.js";
import { pilotState } from "../src/pilota.js";
import { KeychainError, macKeychain, windowsKeychain, type Keychain } from "../src/portachiavi.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

// Everything here is invented: no real account is ever called.
const NOW = "2026-11-01T09:00:00Z";
const TODAY = "2026-11-01";
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASS = "frase di prova non vera";
const SMOOBU_FILE = "smoobu-credentials.json";
const BEDS24_FILE = "beds24-credentials.json";

let smoobu: FakeSmoobu | null = null;
let smoobuNow = NOW;
let beds24: FakeBeds24 | null = null;
afterEach(async () => {
  await smoobu?.close();
  await beds24?.close();
  smoobu = null;
  beds24 = null;
  smoobuNow = NOW;
});

function fakeKeychain(saved: string | null = null, down = false): Keychain & { saved: string | null } {
  const k = {
    saved,
    read() {
      if (down) throw new KeychainError();
      return k.saved;
    },
    save(p: string) {
      if (down) throw new KeychainError();
      k.saved = p;
    },
    remove() {
      k.saved = null;
    },
  };
  return k;
}

const LOFT = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 }, dayOfWeek: { enabled: true, adjustments: { sat: 10 } }, rounding: { enabled: true, step: 1 } },
};

function ratesAt(price: number) {
  const days: Record<string, { price: number | null; min_length_of_stay: number | null; available: number }> = {};
  for (let i = 0; i < 120; i++) days[addDays(TODAY, i)] = { price, min_length_of_stay: 2, available: 1 };
  return days;
}

/** A folder with an autopilot that would write, and the Smoobu keys saved in clear as today. */
async function folder(language?: string, price = 100) {
  smoobu = await startFakeSmoobu({
    ...TEST_CREDENTIALS,
    now: () => new Date(smoobuNow),
    apartments: [{ id: 398, name: "Seaside Loft", currency: "EUR", minimal: "80.00", maximal: "180.00" }],
    bookings: [],
    rates: { 398: ratesAt(price) },
    rangeEnd: "exclusive",
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const config = { ...(language ? { language } : {}), listings: [{ name: "loft", calendars: [{ source: "smoobu", apartmentId: 398 }], pricing: LOFT, pilot: { enabled: true } }] };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(config, null, 2));
  saveCredentials(dir, TEST_CREDENTIALS);
  return dir;
}

function io(dir: string, extra: Partial<TestIo> = {}): TestIo {
  const base = testIo(dir, undefined, NOW);
  Object.assign(base, {
    env: {},
    keychain: null,
    scryptCost: FAST,
    smoobuBaseUrl: smoobu?.baseUrl,
    smoobuFetch: (url: string, init: RequestInit) => fetch(url, init),
    sleep: async () => {},
    ...extra,
  });
  return base;
}

function answers(...list: string[]) {
  const queue = [...list];
  const asked: { q: string; hidden: boolean }[] = [];
  const prompt = async (q: string, o: { hidden: boolean }) => {
    asked.push({ q, hidden: o.hidden });
    if (queue.length === 0) throw new Error(`no answer left for "${q}"`);
    return queue.shift() as string;
  };
  return { prompt, asked, left: () => queue.length };
}

async function encrypt(dir: string, keychain: Keychain | null = null) {
  const a = answers("s", PASS, PASS, keychain ? "" : "n");
  const t = io(dir, { keychain, prompt: a.prompt });
  expect(await main(["chiavi", "cifra"], t)).toBe(0);
  return t;
}

const posts = () => (smoobu as FakeSmoobu).log.filter((r) => r.method === "POST");
const text = (dir: string, file: string) => readFileSync(path.join(dir, file), "utf8");

/** Nothing the host sees or the log keeps holds a secret. */
function noSecrets(t: TestIo) {
  const all = [...t.lines, ...t.errors].join("\n");
  for (const secret of [PASS, TEST_CREDENTIALS.apiKey, TEST_CREDENTIALS.apiSecret, TEST_REFRESH]) expect(all).not.toContain(secret);
}

describe("a folder that never turned it on", () => {
  it("keeps working in clear: same file, no question, the autopilot writes, the keychain is not touched", async () => {
    const dir = await folder();
    const before = text(dir, SMOOBU_FILE);
    const t = io(dir, { keychain: { read: () => { throw new Error("not to be called"); }, save: () => {}, remove: () => {} } });
    expect(await main(["pilota", "giro"], t)).toBe(0);
    expect(posts().length).toBeGreaterThan(0);
    expect(text(dir, SMOOBU_FILE)).toBe(before);
    expect(JSON.parse(before)).toEqual(TEST_CREDENTIALS);
    expect(existsSync(path.join(dir, "chiavi-cifrate.json"))).toBe(false);
  });

  it("a file in clear with extra spaces or a Beds24 cached token still loads", async () => {
    const dir = tempDir();
    saveBeds24Credentials(dir, "plain-refresh-not-real", { token: "t1", expiresAt: "2026-11-02T10:00:00.000Z" });
    expect(loadBeds24Credentials(dir).refreshToken).toBe("plain-refresh-not-real");
    expect(JSON.parse(text(dir, BEDS24_FILE)).refreshToken).toBe("plain-refresh-not-real");
  });
});

describe("fairnight chiavi cifra", () => {
  it("asks to confirm, seals the file, and the keys still work", async () => {
    const dir = await folder();
    const a = answers("s", PASS, PASS, "n");
    const t = io(dir, { prompt: a.prompt });
    expect(await main(["chiavi", "cifra"], t)).toBe(0);
    expect(a.asked.slice(1, 3).every((q) => q.hidden)).toBe(true);
    const saved = text(dir, SMOOBU_FILE);
    expect(Object.keys(JSON.parse(saved))).toEqual(["sealed"]);
    for (const secret of [TEST_CREDENTIALS.apiKey, TEST_CREDENTIALS.apiSecret, PASS]) {
      expect(saved).not.toContain(secret);
      expect(text(dir, "chiavi-cifrate.json")).not.toContain(secret);
    }
    noSecrets(t);
    const reader = io(dir, { env: { FAIRNIGHT_FRASE_CHIAVI: PASS } });
    expect(loadCredentials(dir, reader.env, reader)).toEqual({ credentials: TEST_CREDENTIALS, source: "file" });
  });

  it("changes nothing without the yes, or with two different passphrases, or a short one", async () => {
    const dir = await folder();
    const before = text(dir, SMOOBU_FILE);
    const no = io(dir, { prompt: answers("n").prompt });
    expect(await main(["chiavi", "cifra"], no)).toBe(0);
    expect(await main(["chiavi", "cifra"], io(dir, { prompt: answers("s", PASS, "altra frase di prova").prompt }))).toBe(1);
    expect(await main(["chiavi", "cifra"], io(dir, { prompt: answers("s", "corta").prompt }))).toBe(1);
    expect(text(dir, SMOOBU_FILE)).toBe(before);
    expect(existsSync(path.join(dir, "chiavi-cifrate.json"))).toBe(false);
  });

  it("does not touch anything when a file in clear is broken", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, BEDS24_FILE), "{ broken secret-value-x");
    const t = io(dir, { prompt: answers().prompt });
    expect(await main(["chiavi", "cifra"], t)).toBe(1);
    expect(t.errors.join("\n")).toContain(BEDS24_FILE);
    expect(t.errors.join("\n")).not.toContain("secret-value-x");
    expect(JSON.parse(text(dir, SMOOBU_FILE))).toEqual(TEST_CREDENTIALS);
  });

  it("finishes a run stopped halfway with the same key, and needs a terminal", async () => {
    const dir = await folder();
    await encrypt(dir);
    writeFileSync(path.join(dir, SMOOBU_FILE), JSON.stringify(TEST_CREDENTIALS));
    expect(await main(["chiavi", "cifra"], io(dir, { prompt: answers("s", PASS, "n").prompt }))).toBe(0);
    expect(text(dir, SMOOBU_FILE)).toContain("sealed");
    expect(await main(["chiavi", "chiaro"], io(dir))).toBe(1);
  });

  it("seals what collega saves afterwards, with no passphrase asked", async () => {
    const dir = await folder();
    await encrypt(dir);
    const a = answers(TEST_CREDENTIALS.apiKey, TEST_CREDENTIALS.apiSecret);
    const t = io(dir, { prompt: a.prompt });
    expect(await main(["smoobu", "collega"], t)).toBe(0);
    expect(a.left()).toBe(0);
    expect(text(dir, SMOOBU_FILE)).not.toContain(TEST_CREDENTIALS.apiKey);
    expect(t.lines.join("\n")).toContain("encrypted with your passphrase");
  });
});

describe("a wrong passphrase", () => {
  it("is refused with a clear error, and nothing changes or leaks", async () => {
    const dir = await folder();
    await encrypt(dir);
    const before = text(dir, SMOOBU_FILE);
    const t = io(dir, { prompt: answers("frase sbagliata di prova").prompt });
    expect(await main(["chiavi", "chiaro"], t)).toBe(1);
    expect(t.errors[0]).toMatch(/^Passphrase sbagliata/);
    expect(t.errors.join("\n")).not.toContain("frase sbagliata di prova");
    expect(text(dir, SMOOBU_FILE)).toBe(before);
    noSecrets(t);
  });

  it("from the variable stops the run too, and ricorda refuses it before 06:00", async () => {
    const dir = await folder();
    await encrypt(dir);
    const t = io(dir, { env: { FAIRNIGHT_FRASE_CHIAVI: "frase sbagliata di prova" } });
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(1);
    expect(posts()).toEqual([]);
    expect(t.lines.join("\n")).toContain("Passphrase sbagliata");
    const k = fakeKeychain();
    expect(await main(["chiavi", "ricorda"], io(dir, { keychain: k, prompt: answers("frase sbagliata di prova").prompt }))).toBe(1);
    expect(k.saved).toBeNull();
  });
});

describe("fairnight chiavi chiaro", () => {
  it("asks the passphrase and the yes, gives the same file back and forgets the passphrase", async () => {
    const dir = await folder();
    const k = fakeKeychain();
    await encrypt(dir, k);
    expect(k.saved).toBe(PASS);
    const a = answers(PASS, "s");
    const t = io(dir, { keychain: k, prompt: a.prompt });
    expect(await main(["chiavi", "chiaro"], t)).toBe(0);
    expect(a.asked[0]?.hidden).toBe(true);
    expect(JSON.parse(text(dir, SMOOBU_FILE))).toEqual(TEST_CREDENTIALS);
    expect(existsSync(path.join(dir, "chiavi-cifrate.json"))).toBe(false);
    expect(k.saved).toBeNull();
    expect(await main(["pilota", "giro"], io(dir))).toBe(0);
    expect(posts().length).toBeGreaterThan(0);
    noSecrets(t);
  });

  it("without the yes everything stays encrypted", async () => {
    const dir = await folder();
    await encrypt(dir);
    expect(await main(["chiavi", "chiaro"], io(dir, { prompt: answers(PASS, "n").prompt }))).toBe(0);
    expect(text(dir, SMOOBU_FILE)).toContain("sealed");
  });
});

describe("the autopilot with encrypted keys", () => {
  it("opens them from the keychain, alone, and writes", async () => {
    const dir = await folder();
    const k = fakeKeychain();
    await encrypt(dir, k);
    const t = io(dir, { keychain: k, prompt: async () => { throw new Error("nobody is there"); } });
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(0);
    expect(posts().length).toBeGreaterThan(0);
    noSecrets(t);
  });

  it("uses FAIRNIGHT_FRASE_CHIAVI on a server with no keychain", async () => {
    const dir = await folder();
    await encrypt(dir);
    const t = io(dir, { env: { FAIRNIGHT_FRASE_CHIAVI: PASS } });
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(0);
    expect(posts().length).toBeGreaterThan(0);
    noSecrets(t);
  });

  it("without any passphrase stops with the reason, sends no price and does not pause the listing", async () => {
    const dir = await folder();
    await encrypt(dir);
    const t = io(dir, { prompt: async () => { throw new Error("a scheduled run must not ask"); } });
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(1);
    expect(posts()).toEqual([]);
    expect((smoobu as FakeSmoobu).log).toEqual([]);
    const said = t.lines.join("\n");
    expect(said).toContain("nessun prezzo è partito");
    expect(said).toContain("FAIRNIGHT_FRASE_CHIAVI");
    expect(said).toContain("fairnight chiavi azzera");
    expect(said).not.toContain("PAUSED");
    expect(text(dir, path.join("data", "pilota.log"))).toContain("nessun prezzo");
    noSecrets(t);
  });

  it("stops when the keychain does not answer, and when it lost the passphrase", async () => {
    const dir = await folder();
    await encrypt(dir);
    const down = io(dir, { keychain: fakeKeychain(PASS, true) });
    expect(await main(["pilota", "giro", "--pianificato"], down)).toBe(1);
    expect(down.lines.join("\n")).toContain("non ha risposto");
    for (const keychain of [fakeKeychain(null), fakeKeychain("una frase di un'altra volta")]) {
      const t = io(dir, { keychain });
      expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(1);
      expect(t.lines.join("\n")).toContain("fairnight chiavi ricorda");
      expect(t.lines.join("\n")).toContain("fairnight smoobu collega");
      noSecrets(t);
    }
    expect(posts()).toEqual([]);
  });

  it("a run stopped by closed keys does not use up the day: once written again, it goes", async () => {
    const dir = await folder();
    const k = fakeKeychain();
    await encrypt(dir, k);
    await main(["chiavi", "dimentica"], io(dir, { keychain: k }));
    expect(await main(["pilota", "giro", "--pianificato"], io(dir, { keychain: k }))).toBe(1);
    expect(await main(["chiavi", "ricorda"], io(dir, { keychain: k, prompt: answers(PASS).prompt }))).toBe(0);
    expect(await main(["pilota", "giro", "--pianificato"], io(dir, { keychain: k }))).toBe(0);
    expect(posts().length).toBeGreaterThan(0);
    const again = io(dir, { keychain: k });
    await main(["pilota", "giro", "--pianificato"], again);
    expect(again.lines).toEqual(["Today's autopilot run is already done."]);
  });

  it("falls back on the variable when the keychain does not answer", async () => {
    const dir = await folder();
    await encrypt(dir);
    expect(await main(["pilota", "giro", "--pianificato"], io(dir, { keychain: fakeKeychain(PASS, true), env: { FAIRNIGHT_FRASE_CHIAVI: PASS } }))).toBe(0);
    expect(posts().length).toBeGreaterThan(0);
  });

  it("in a terminal with no keychain asks once, however many times the keys are read", async () => {
    const dir = await folder();
    await encrypt(dir);
    const a = answers(PASS);
    expect(await main(["pilota", "giro"], io(dir, { prompt: a.prompt }))).toBe(0);
    expect(a.asked).toHaveLength(1);
    expect(a.asked[0]?.hidden).toBe(true);
    expect(posts().length).toBeGreaterThan(0);
  });

  it("says whether a run alone can open them", async () => {
    const dir = await folder();
    await encrypt(dir);
    const no = io(dir);
    await main(["pilota", "stato"], no);
    expect(no.lines.join("\n")).toContain("NON può aprirle");
    const yes = io(dir, { keychain: fakeKeychain(PASS) });
    await main(["pilota", "stato"], yes);
    expect(yes.lines.join("\n")).toContain("può aprirle");
    expect(yes.lines.join("\n")).not.toContain("NON");
  });

  it("speaks the host's language when it stops", async () => {
    for (const [language, word] of [["es", "ningún precio"], ["en", "no price was sent"], ["it", "nessun prezzo"]] as const) {
      const dir = await folder(language);
      await encrypt(dir);
      const t = io(dir);
      expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(1);
      expect(t.lines.join("\n")).toContain(word);
      await smoobu?.close();
      smoobu = null;
    }
  });
});

describe("encrypted keys and the daily cap together", () => {
  // 2026-11-07 and the 14th are Saturdays: 110 calculated, 80 on the channel, 92 under the cap.
  const SATURDAY = "2026-11-07";
  const NEXT_SATURDAY = "2026-11-14";
  const TOMORROW = "2026-11-02T09:00:00Z";
  const NEXT_DAY = { now: () => new Date(TOMORROW) };
  const SYSTEM = { platform: "win32" as const, home: "C:/Users/anna", user: "anna", uid: null, node: "C:/node.exe", script: "C:/fairnight.js" };
  const priceOn = (date: string) => (smoobu as FakeSmoobu).rates[398]?.[date]?.price;

  function saved(dir: string) {
    const db = openDb(path.join(dir, "data", "fairnight.db"));
    try {
      return {
        held: db.prepare("SELECT sent FROM pilot_held WHERE listing = 'loft' AND date = ?").get(SATURDAY),
        confirmed: activeConfirmations(db, "loft", "2026-11-02").get(SATURDAY)?.by,
        written: db.prepare("SELECT COUNT(*) AS n FROM pilot_changes").get(),
        failures: pilotState(db, "loft").failures,
        confirmedRun: db.prepare("SELECT confirmed_by FROM pilot_changes WHERE date = ? AND new_price = 110").get(SATURDAY),
      };
    } finally {
      db.close();
    }
  }

  it("with the keychain the cap and the confirmation apply; emptied, nothing reaches the channel and nothing is lost", async () => {
    const dir = await folder(undefined, 80);
    const k = fakeKeychain();
    await encrypt(dir, k);

    expect(await main(["pilota", "giro", "--pianificato"], io(dir, { keychain: k }))).toBe(0);
    expect(priceOn(SATURDAY)).toBe(92);
    expect(saved(dir).held).toEqual({ sent: 92 });

    // Confirming reads no credentials: it works with no passphrase at all.
    expect(await main(["chiavi", "dimentica"], io(dir, { keychain: k }))).toBe(0);
    expect(await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir, { keychain: k, system: SYSTEM }))).toBe(0);
    const before = saved(dir);
    expect(before.confirmed).toBe("anna");

    smoobuNow = TOMORROW;
    const asked = (smoobu as FakeSmoobu).log.length;
    const stopped = io(dir, { keychain: k, ...NEXT_DAY, prompt: async () => { throw new Error("a scheduled run must not ask"); } });
    expect(await main(["pilota", "giro", "--pianificato"], stopped)).toBe(1);
    expect((smoobu as FakeSmoobu).log.length).toBe(asked);
    expect(priceOn(SATURDAY)).toBe(92);
    expect(stopped.lines.join("\n")).toContain("nessun prezzo è partito");
    expect(saved(dir)).toEqual(before); // the mark, the confirmation and the log as they were, no failure counted
    noSecrets(stopped);

    expect(await main(["chiavi", "ricorda"], io(dir, { keychain: k, prompt: answers(PASS).prompt }))).toBe(0);
    expect(await main(["pilota", "giro", "--pianificato"], io(dir, { keychain: k, ...NEXT_DAY }))).toBe(0);
    expect(priceOn(SATURDAY)).toBe(110);
    expect(priceOn(NEXT_SATURDAY)).toBe(105); // 92 × 1.15 = 105.8: not confirmed, the cap as always
    expect(saved(dir).confirmedRun).toEqual({ confirmed_by: "anna" });
    expect(saved(dir).held).toBeUndefined();
  });
});

describe("damaged files", () => {
  const stop = async (dir: string) => {
    const t = io(dir, { keychain: fakeKeychain(PASS) });
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(1);
    expect(posts()).toEqual([]);
    noSecrets(t);
    return t.lines.join("\n");
  };

  it("a sealed value changed by one letter stops the run", async () => {
    const dir = await folder();
    await encrypt(dir);
    const { sealed } = JSON.parse(text(dir, SMOOBU_FILE)) as { sealed: string };
    const flip = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    writeFileSync(path.join(dir, SMOOBU_FILE), JSON.stringify({ sealed: flip }));
    expect(await stop(dir)).toContain("danneggiato");
  });

  it("a sealed value that is not one stops the run", async () => {
    const dir = await folder();
    await encrypt(dir);
    const t = io(dir, { env: { FAIRNIGHT_FRASE_CHIAVI: PASS } });
    writeFileSync(path.join(dir, SMOOBU_FILE), JSON.stringify({ sealed: "fg1.a.b.c.d" }));
    expect(() => loadCredentials(dir, t.env, t)).toThrow(/danneggiato/);
    writeFileSync(path.join(dir, SMOOBU_FILE), JSON.stringify({ sealed: "rubbish" }));
    expect(await stop(dir)).toContain("danneggiato");
  });

  it("the file of one channel cannot be passed off as the other's", async () => {
    const dir = await folder();
    await encrypt(dir);
    const t = io(dir, { env: { FAIRNIGHT_FRASE_CHIAVI: PASS } });
    writeFileSync(path.join(dir, BEDS24_FILE), text(dir, SMOOBU_FILE));
    expect(() => loadBeds24Credentials(dir, {}, t)).toThrow(/danneggiato/);
  });

  it("a broken or missing key file stops the run, in clear words", async () => {
    const dir = await folder();
    await encrypt(dir);
    const keys = path.join(dir, "chiavi-cifrate.json");
    writeFileSync(keys, "{ broken");
    expect(await stop(dir)).toContain("chiavi-cifrate.json");
    writeFileSync(keys, JSON.stringify({ version: 1 }));
    expect(await stop(dir)).toContain("danneggiato");
    rmSync(keys);
    expect(await stop(dir)).toContain("manca il file");
  });

  it("a broken credentials file says so without showing it", async () => {
    const dir = await folder();
    await encrypt(dir);
    writeFileSync(path.join(dir, SMOOBU_FILE), "{ not json secret-value-x");
    const said = await stop(dir);
    expect(said).toContain("cannot be read");
    expect(said).not.toContain("secret-value-x");
  });

  it("azzera is the way out: asks for the word, deletes, and the folder starts again", async () => {
    const dir = await folder();
    const k = fakeKeychain();
    await encrypt(dir, k);
    writeFileSync(path.join(dir, SMOOBU_FILE), "{ broken");
    expect(await main(["chiavi", "azzera"], io(dir, { keychain: k, prompt: answers("no").prompt }))).toBe(0);
    expect(existsSync(path.join(dir, "chiavi-cifrate.json"))).toBe(true);
    expect(await main(["chiavi", "azzera"], io(dir, { keychain: k, prompt: answers("AZZERA").prompt }))).toBe(0);
    expect(existsSync(path.join(dir, "chiavi-cifrate.json"))).toBe(false);
    expect(existsSync(path.join(dir, SMOOBU_FILE))).toBe(false);
    expect(k.saved).toBeNull();
  });
});

describe("Beds24 with encrypted keys", () => {
  async function beds() {
    const clock = { now: Date.parse(NOW) };
    beds24 = await startFakeBeds24({
      inviteCode: TEST_INVITE,
      refreshToken: TEST_REFRESH,
      clock,
      properties: [{ id: 10, name: "House", currency: "EUR", rooms: [{ id: 101, name: "Loft", qty: 1 }] }],
      bookings: [],
    });
    const dir = tempDir();
    await main(["init"], testIo(dir));
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [{ name: "loft", calendars: [{ source: "beds24", roomId: 101 }], pricing: LOFT }] }));
    saveBeds24Credentials(dir, TEST_REFRESH, { token: "old-short-not-real", expiresAt: "2026-11-01T08:00:00.000Z" });
    await encrypt(dir);
    const extra = { beds24BaseUrl: beds24.baseUrl, beds24Fetch: (url: string, init: RequestInit) => fetch(url, init), now: () => new Date(clock.now) };
    return { dir, extra };
  }

  it("a new short token stays sealed, and the next run finds it", async () => {
    const { dir, extra } = await beds();
    const env = { FAIRNIGHT_FRASE_CHIAVI: PASS };
    expect(await main(["sync"], io(dir, { env, ...extra }))).toBe(0);
    const saved = text(dir, BEDS24_FILE);
    expect(Object.keys(JSON.parse(saved))).toEqual(["sealed"]);
    expect(saved).not.toContain(TEST_REFRESH);
    const issued = (beds24 as FakeBeds24).tokensIssued();
    expect(await main(["sync"], io(dir, { env, ...extra }))).toBe(0);
    expect((beds24 as FakeBeds24).tokensIssued()).toBe(issued);
  });

  it("a token from the environment needs no passphrase, and leaves the sealed file alone", async () => {
    const { dir, extra } = await beds();
    const before = text(dir, BEDS24_FILE);
    const t = io(dir, { env: { BEDS24_REFRESH_TOKEN: TEST_REFRESH }, ...extra });
    expect(await main(["sync"], t)).toBe(0);
    expect(text(dir, BEDS24_FILE)).toBe(before);
    expect(loadBeds24Credentials(dir, { BEDS24_REFRESH_TOKEN: TEST_REFRESH }).source).toBe("environment");
  });

  it("a closed file never gets a short token in clear", async () => {
    const { dir } = await beds();
    const before = text(dir, BEDS24_FILE);
    saveBeds24Token(dir, TEST_REFRESH, { token: "new-short-not-real", expiresAt: "2026-11-02T08:00:00.000Z" });
    expect(text(dir, BEDS24_FILE)).toBe(before);
  });
});

describe("the keychains", () => {
  type Call = { command: string; args: string[]; input: string | undefined };

  it("Windows: the passphrase goes by stdin, the file holds only what DPAPI gave back", () => {
    const dir = tempDir();
    const file = path.join(dir, "Fairnight", "chiavi-test.json");
    const calls: Call[] = [];
    // A stand-in for DPAPI: reverses the bytes.
    const flip = (b64: string) => Buffer.from(b64, "base64").reverse().toString("base64");
    const k = windowsKeychain(file, "C:\\ps.exe", (command, args, input) => {
      calls.push({ command, args, input });
      return { status: 0, stdout: flip(input as string), stderr: "" };
    });
    expect(k.read()).toBeNull();
    k.save(PASS);
    expect(calls[0]?.command).toBe("C:\\ps.exe");
    expect(calls[0]?.args.join(" ")).toContain("Protect");
    expect(calls[0]?.args.join(" ")).not.toContain(PASS);
    expect(readFileSync(file, "utf8")).not.toContain(PASS);
    expect(readFileSync(file, "utf8")).not.toContain(Buffer.from(PASS).toString("base64"));
    expect(k.read()).toBe(PASS);
    expect(calls[1]?.args.join(" ")).toContain("Unprotect");
    k.remove();
    expect(k.read()).toBeNull();
  });

  it("Windows: a failing PowerShell is 'did not answer', with nothing of what it said", () => {
    const dir = tempDir();
    const file = path.join(dir, "k.json");
    let status = 0;
    const k = windowsKeychain(file, "ps", () => ({ status, stdout: status === 0 ? "AAAA" : "", stderr: "details" }));
    k.save(PASS);
    status = 1;
    expect(() => k.read()).toThrow(KeychainError);
    expect(() => k.save(PASS)).toThrow(KeychainError);
  });

  it("Mac: the passphrase goes by stdin, never as an argument, and is read back", () => {
    const calls: Call[] = [];
    let stored: string | null = null;
    const k = macKeychain("abcd1234", (command, args, input) => {
      calls.push({ command, args, input });
      if (args[0] === "-i") {
        stored = /-w (\S+)\n$/.exec(input as string)?.[1] ?? null;
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "find-generic-password") return stored === null ? { status: 44, stdout: "", stderr: "" } : { status: 0, stdout: `${stored}\n`, stderr: "" };
      stored = null;
      return { status: 0, stdout: "", stderr: "" };
    });
    expect(k.read()).toBeNull();
    k.save("frase con \"virgolette\" e accènti");
    expect(k.read()).toBe("frase con \"virgolette\" e accènti");
    for (const c of calls) {
      expect(c.command).toBe("/usr/bin/security");
      expect(c.args.join(" ")).not.toContain("frase");
    }
    expect(calls.find((c) => c.args[0] === "-i")?.input).not.toContain("frase");
    k.remove();
    expect(k.read()).toBeNull();
  });

  it("Mac: a keychain that says no is 'did not answer', also when the save fails in silence", () => {
    const status = macKeychain("x", () => ({ status: 51, stdout: "", stderr: "" }));
    expect(() => status.read()).toThrow(KeychainError);
    const silent = macKeychain("x", (_c, args) => (args[0] === "-i" ? { status: 0, stdout: "", stderr: "" } : { status: 44, stdout: "", stderr: "" }));
    expect(() => silent.save(PASS)).toThrow(KeychainError);
  });

  it("a host with no keychain is told what a daily run needs", async () => {
    const dir = await folder();
    const t = await encrypt(dir, null);
    expect(t.lines.join("\n")).not.toContain("portachiavi di questo computer: il giro");
    const remember = answers(PASS);
    const r = io(dir, { prompt: remember.prompt });
    expect(await main(["chiavi", "ricorda"], r)).toBe(1);
    expect(r.lines.join("\n")).toContain("FAIRNIGHT_FRASE_CHIAVI");
  });
});

describe("fairnight chiavi stato", () => {
  it("says what is encrypted, never a value", async () => {
    const dir = await folder();
    const clear = io(dir);
    expect(await main(["chiavi"], clear)).toBe(0);
    expect(clear.lines).toContain("Smoobu: in chiaro");
    expect(clear.lines).toContain("Beds24: non collegato");
    const k = fakeKeychain();
    await encrypt(dir, k);
    const sealed = io(dir, { keychain: k });
    expect(await main(["chiavi", "stato"], sealed)).toBe(0);
    expect(sealed.lines).toContain("Smoobu: cifrato");
    expect(sealed.lines.join("\n")).toContain("ha la passphrase");
    noSecrets(sealed);
    const forget = io(dir, { keychain: k });
    expect(await main(["chiavi", "dimentica"], forget)).toBe(0);
    expect(k.saved).toBeNull();
  });
});

describe("the three languages", () => {
  it("have the same words, none of them empty", () => {
    const dir = tempDir();
    const pick = (locale: string, language?: string) => {
      if (language) writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ language }));
      return keyTexts(dir, { locale } as Pick<Io, "locale">);
    };
    const [it_, es, en] = [pick("it-IT", "it"), pick("es-ES", "es"), pick("en-US", "en")];
    expect(Object.keys(es)).toEqual(Object.keys(it_));
    expect(Object.keys(en)).toEqual(Object.keys(it_));
    expect(it_.wrong).not.toBe(es.wrong);
    expect(es.wrong).not.toBe(en.wrong);
  });
});
