import { describe, expect, it } from "vitest";
import { checkFreshness, type FreshnessInput } from "../src/index.js";

const base: FreshnessInput = {
  draft: { id: 7, messageId: "m2", status: "waiting" },
  stay: { cancelled: false, checkOut: "2026-11-10" },
  lastMessage: { id: "m2", from: "guest" },
  latestDraftId: 7,
  today: "2026-11-05",
};
const with_ = (patch: Partial<FreshnessInput>): FreshnessInput => ({ ...base, ...patch });

describe("checkFreshness", () => {
  it("lets a draft that answers the last guest message be sent", () => {
    expect(checkFreshness(base)).toEqual({ sendable: true, reason: null });
    expect(checkFreshness(with_({ draft: { ...base.draft, status: "approved" } })).sendable).toBe(true);
    expect(checkFreshness(with_({ draft: { ...base.draft, status: "failed" } })).sendable).toBe(true);
  });

  it("refuses a cancelled booking first", () => {
    expect(checkFreshness(with_({ stay: { cancelled: true, checkOut: "2026-11-10" }, lastMessage: undefined }))).toEqual({ sendable: false, reason: "cancelled" });
  });

  it("refuses a draft already sent, being sent or discarded", () => {
    expect(checkFreshness(with_({ draft: { ...base.draft, status: "sent" } })).reason).toBe("already_sent");
    expect(checkFreshness(with_({ draft: { ...base.draft, status: "sending" } })).reason).toBe("already_sent");
    expect(checkFreshness(with_({ draft: { ...base.draft, status: "discarded" } })).reason).toBe("discarded");
  });

  it("keeps only the newest draft of a conversation", () => {
    expect(checkFreshness(with_({ latestDraftId: 8 })).reason).toBe("superseded");
  });

  it("refuses when the host already answered, or the guest wrote again", () => {
    expect(checkFreshness(with_({ lastMessage: undefined })).reason).toBe("no_message");
    expect(checkFreshness(with_({ lastMessage: { id: "m3", from: "host" } })).reason).toBe("host_turn");
    expect(checkFreshness(with_({ lastMessage: { id: "m3", from: "system" } })).reason).toBe("host_turn");
    expect(checkFreshness(with_({ lastMessage: { id: "m3", from: "guest" } })).reason).toBe("newer_message");
  });

  it("allows two days after check-out, not three", () => {
    expect(checkFreshness(with_({ today: "2026-11-12" })).sendable).toBe(true);
    expect(checkFreshness(with_({ today: "2026-11-13" })).reason).toBe("stay_ended");
  });
});
