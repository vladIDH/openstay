import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateHostConfig, type HostListing } from "../src/config.js";
import { openDb, type Db } from "../src/db.js";
import { syncListings } from "../src/sync.js";
import { fakeFetch, fixture, tempDir } from "./helpers.js";

const AIRBNB = "https://cal.example.org/airbnb/loft.ics";
const BOOKING = "https://cal.example.org/booking/loft.ics";

function listing(): HostListing {
  const r = validateHostConfig({
    listings: [
      {
        name: "loft",
        calendars: [
          { source: "airbnb", url: AIRBNB },
          { source: "booking", url: BOOKING },
        ],
        pricing: { currency: "EUR", basePrice: 100, defaultMinStay: 2, factors: {} },
      },
    ],
  });
  if (!r.ok) throw new Error("bad test config");
  return r.value.listings[0] as HostListing;
}

function rows(db: Db) {
  return db
    .prepare("SELECT feed, uid, check_in, check_out, kind, removed_at FROM calendar_events ORDER BY feed, check_in")
    .all() as { feed: string; uid: string; check_in: string; check_out: string; kind: string; removed_at: string | null }[];
}

const open: Db[] = [];
afterEach(() => {
  // Close before the folder is deleted: Windows cannot delete an open file.
  for (const db of open.splice(0)) if (db.open) db.close();
});

function freshDb(): Db {
  const db = openDb(path.join(tempDir(), "data", "fairnight.db"));
  open.push(db);
  return db;
}

const at = (iso: string) => ({ now: new Date(iso) });

describe("calendar sync", () => {
  it("stores stays and blocks from every calendar, and asks only for the configured links", async () => {
    const db = freshDb();
    const fetch = fakeFetch({ [AIRBNB]: fixture("airbnb-esempio.ics"), [BOOKING]: fixture("booking-esempio.ics") });
    const reports = await syncListings(db, [listing()], { fetch, ...at("2026-11-01T08:00:00Z") });
    expect(fetch.calls).toEqual([AIRBNB, BOOKING]);
    expect(reports.map((r) => [r.feed, r.ok, r.seen, r.added])).toEqual([
      ["airbnb", true, 3, 3],
      ["booking", true, 2, 2],
    ]);
    expect(rows(db).map((r) => [r.feed, r.check_in, r.check_out, r.kind])).toEqual([
      ["airbnb", "2026-11-04", "2026-11-08", "reservation"],
      ["airbnb", "2026-12-01", "2026-12-05", "blocked"],
      ["airbnb", "2026-12-25", "2026-12-30", "reservation"],
      ["booking", "2026-11-10", "2026-11-15", "reservation"],
      ["booking", "2026-11-20", "2026-11-23", "reservation"],
    ]);
    db.close();
  });

  it("adds nothing when run twice", async () => {
    const db = freshDb();
    const fetch = fakeFetch({ [AIRBNB]: fixture("airbnb-esempio.ics"), [BOOKING]: fixture("booking-esempio.ics") });
    await syncListings(db, [listing()], { fetch, ...at("2026-11-01T08:00:00Z") });
    const before = rows(db);
    const second = await syncListings(db, [listing()], { fetch, ...at("2026-11-01T11:00:00Z") });
    expect(second.map((r) => [r.added, r.changed, r.removed, r.restored])).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(rows(db)).toEqual(before);
    const runs = db.prepare("SELECT COUNT(*) AS n FROM sync_runs").get() as { n: number };
    expect(runs.n).toBe(4);
    db.close();
  });

  it("marks a stay that disappeared as removed, and restores it if it comes back", async () => {
    const db = freshDb();
    const full = fixture("booking-esempio.ics");
    const fetch = fakeFetch({ [AIRBNB]: fixture("airbnb-esempio.ics"), [BOOKING]: full });
    await syncListings(db, [listing()], { fetch, ...at("2026-11-01T08:00:00Z") });

    // The 20–23 November stay is cancelled: it vanishes from the Booking calendar.
    const withoutSecond = full.replace(/BEGIN:VEVENT\r\nUID:8d2f[\s\S]*?END:VEVENT\r\n/, "");
    fetch.set(BOOKING, withoutSecond);
    const r1 = await syncListings(db, [listing()], { fetch, ...at("2026-11-02T08:00:00Z") });
    expect(r1[1]).toMatchObject({ seen: 1, removed: 1 });
    const gone = rows(db).find((r) => r.uid === "8d2f1b0c4a3e5f6b@booking.example");
    expect(gone?.removed_at).toBe("2026-11-02T08:00:00.000Z");
    expect(rows(db)).toHaveLength(5); // kept, not deleted

    // Running again does not remove it twice.
    const r2 = await syncListings(db, [listing()], { fetch, ...at("2026-11-02T09:00:00Z") });
    expect(r2[1]?.removed).toBe(0);
    expect(rows(db).find((r) => r.uid === gone?.uid)?.removed_at).toBe("2026-11-02T08:00:00.000Z");

    // It comes back (re-booked).
    fetch.set(BOOKING, full);
    const r3 = await syncListings(db, [listing()], { fetch, ...at("2026-11-03T08:00:00Z") });
    expect(r3[1]?.restored).toBe(1);
    expect(rows(db).find((r) => r.uid === gone?.uid)?.removed_at).toBeNull();
    db.close();
  });

  it("updates a stay whose dates changed", async () => {
    const db = freshDb();
    const full = fixture("booking-esempio.ics");
    const fetch = fakeFetch({ [AIRBNB]: fixture("airbnb-esempio.ics"), [BOOKING]: full });
    await syncListings(db, [listing()], { fetch, ...at("2026-11-01T08:00:00Z") });
    fetch.set(BOOKING, full.replace("DTEND;VALUE=DATE:20261123", "DTEND;VALUE=DATE:20261124"));
    const r = await syncListings(db, [listing()], { fetch, ...at("2026-11-02T08:00:00Z") });
    expect(r[1]).toMatchObject({ changed: 1, added: 0, removed: 0 });
    expect(rows(db).find((x) => x.uid === "8d2f1b0c4a3e5f6b@booking.example")?.check_out).toBe("2026-11-24");
    db.close();
  });

  it("changes nothing for a calendar that cannot be read", async () => {
    const db = freshDb();
    const fetch = fakeFetch({ [AIRBNB]: fixture("airbnb-esempio.ics"), [BOOKING]: fixture("booking-esempio.ics") });
    await syncListings(db, [listing()], { fetch, ...at("2026-11-01T08:00:00Z") });
    const before = rows(db);

    fetch.set(AIRBNB, { status: 503 });
    fetch.set(BOOKING, "<html>Please log in</html>");
    const r = await syncListings(db, [listing()], { fetch, ...at("2026-11-02T08:00:00Z") });
    expect(r.map((x) => [x.ok, x.error])).toEqual([
      [false, "the server answered HTTP 503"],
      [false, "this is not an iCal calendar (no BEGIN:VCALENDAR)"],
    ]);
    expect(rows(db)).toEqual(before);

    fetch.set(AIRBNB, new Error("getaddrinfo ENOTFOUND cal.example.org"));
    const r2 = await syncListings(db, [listing()], { fetch, ...at("2026-11-02T09:00:00Z") });
    expect(r2[0]?.error).toBe("getaddrinfo ENOTFOUND cal.example.org");
    expect(rows(db)).toEqual(before);
    const failedRuns = db.prepare("SELECT COUNT(*) AS n FROM sync_runs WHERE ok = 0").get() as { n: number };
    expect(failedRuns.n).toBe(4); // two calendars failed in each of the last two runs
    db.close();
  });

  it("refuses a calendar that is too big", async () => {
    const db = freshDb();
    const huge = "BEGIN:VCALENDAR\n" + "X".repeat(5_000_001);
    const fetch = fakeFetch({ [AIRBNB]: huge, [BOOKING]: fixture("booking-esempio.ics") });
    const r = await syncListings(db, [listing()], { fetch, ...at("2026-11-01T08:00:00Z") });
    expect(r[0]).toMatchObject({ ok: false, error: "the calendar is larger than 5 MB" });
    expect(r[1]?.ok).toBe(true);
    db.close();
  });
});
