import { describe, expect, it } from "vitest";
import { registryFor, SES_NOT_READY, validateGuestSettings } from "../src/index.js";
import { NotAvailableError } from "../src/types.js";
import { spainDeadlines, spainRetention } from "../src/spain.js";
import { stay } from "./data.js";

describe("deadlines", () => {
  it("counts 24 hours from the booking and from check-in", () => {
    expect(spainDeadlines({ checkIn: "2099-06-10", checkInTime: "16:00", bookedAt: "2099-05-20T09:30", seenAt: "2099-05-21T08:00" })).toEqual([
      { kind: "reservation", due: "2099-05-21T09:30", from: "the booking (2099-05-20 09:30)" },
      { kind: "checkin", due: "2099-06-11T16:00", from: "check-in (2099-06-10 16:00)" },
    ]);
  });

  it("counts from midnight when the hour is not known, never later than the real deadline", () => {
    const [rh, pv] = spainDeadlines({ checkIn: "2099-06-10", bookedAt: "2099-05-20", seenAt: "2099-05-21T08:00" });
    expect(rh?.due).toBe("2099-05-21T00:00");
    expect(pv?.due).toBe("2099-06-11T00:00");
  });

  it("counts from when the booking was first seen when its date is unknown", () => {
    expect(spainDeadlines({ checkIn: "2099-06-10", bookedAt: null, seenAt: "2099-05-21T08:00" })[0]?.due).toBe("2099-05-22T08:00");
  });
});

describe("retention", () => {
  const accepted = [{ kind: "checkin" as const, status: "accepted" as const, at: "2099-06-10T18:00" }];

  it("professional: 3 years from check-out", () => {
    expect(spainRetention({ checkOut: "2099-06-13", cancelledAt: null }, { professional: true }, accepted).eraseFrom).toBe("2102-06-13T00:00");
  });

  it("non-professional: as soon as the check-in communication is accepted", () => {
    expect(spainRetention({ checkOut: "2099-06-13", cancelledAt: null }, { professional: false }, accepted).eraseFrom).toBe("2099-06-10T18:00");
    const sentOnly = [{ kind: "checkin" as const, status: "sent" as const, at: "2099-06-10T18:00" }];
    expect(spainRetention({ checkOut: "2099-06-13", cancelledAt: null }, { professional: false }, sentOnly).eraseFrom).toBeNull();
  });

  it("non-professional and cancelled: 48 hours later", () => {
    expect(spainRetention({ checkOut: "2099-06-13", cancelledAt: "2099-06-01T10:00" }, { professional: false }, []).eraseFrom).toBe("2099-06-03T10:00");
  });
});

describe("SES", () => {
  it("validates, but refuses to prepare until the Ministry's schemas are there", () => {
    const ses = registryFor("ES");
    expect(ses.validate(stay(), "checkin")).toEqual([]);
    expect(() => ses.prepare([stay()], "checkin", "2099-06-10T18:00")).toThrow(NotAvailableError);
    expect(() => ses.prepare([stay()], "checkin", "2099-06-10T18:00")).toThrow(SES_NOT_READY);
    expect(SES_NOT_READY).toMatch(/openstay-ses-docs/);
    expect(SES_NOT_READY).toMatch(/Nothing was prepared and nothing was sent/);
  });
});

describe("settings", () => {
  it("reads a fairguest block with defaults", () => {
    expect(validateGuestSettings({ country: "ES-CT", establishment: "zz00000000", establishmentName: "Casa di Prova" }, "f")).toEqual({
      value: { country: "ES-CT", establishment: "ZZ00000000", establishmentName: "Casa di Prova", professional: false },
      issues: [],
    });
  });

  it("reports every problem", () => {
    const r = validateGuestSettings({ country: "PT", establishment: "", checkInTime: "25:00", rooms: 0, extra: 1 }, "f");
    expect(r.value).toBeNull();
    expect(r.issues.map((i) => i.path)).toEqual(["f.extra", "f.country", "f.establishment", "f.checkInTime", "f.rooms"]);
  });
});
