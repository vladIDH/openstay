/**
 * Is this draft still the right answer? The one check used both when the page
 * shows a draft and again right before it is sent, so the two never disagree.
 *
 * A draft can be sent only when all of these hold:
 * - the booking is not cancelled;
 * - the draft is still waiting or approved (not sent, not being sent, not discarded);
 * - it is the newest draft of its conversation;
 * - it answers the LAST message of the conversation, and that message is the guest's
 *   (a newer guest message, or a reply already written by the host, makes it stale);
 * - the stay ended at most GRACE_DAYS days ago.
 */

/** Days after check-out during which a guest can still be answered. */
export const GRACE_DAYS = 2;

export type StaleReason =
  | "cancelled" // the booking was cancelled
  | "already_sent" // sent, or being sent right now
  | "discarded" // the host threw it away
  | "superseded" // a newer draft exists for the same conversation
  | "host_turn" // the last message is already the host's (or the channel's)
  | "newer_message" // the guest wrote again after the message this draft answers
  | "no_message" // no message in the conversation
  | "stay_ended"; // check-out was more than GRACE_DAYS days ago

export type DraftStatus = "waiting" | "approved" | "sending" | "sent" | "discarded" | "failed";

export interface FreshnessInput {
  draft: { id: number; messageId: string; status: DraftStatus };
  stay: { cancelled: boolean; checkOut: string };
  /** The last message of the conversation, in the channel's order; undefined when empty. */
  lastMessage: { id: string; from: "guest" | "host" | "system" } | undefined;
  /** Id of the newest draft of this conversation. */
  latestDraftId: number;
  /** Today on the host's computer, YYYY-MM-DD. */
  today: string;
}

export type Freshness = { sendable: true; reason: null } | { sendable: false; reason: StaleReason };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pure: the data comes already read, so the page and the sending use the same rule. */
export function checkFreshness(input: FreshnessInput): Freshness {
  const { draft, stay, lastMessage, latestDraftId, today } = input;
  const no = (reason: StaleReason): Freshness => ({ sendable: false, reason });
  if (stay.cancelled) return no("cancelled");
  if (draft.status === "sent" || draft.status === "sending") return no("already_sent");
  if (draft.status === "discarded") return no("discarded");
  if (draft.id !== latestDraftId) return no("superseded");
  if (!lastMessage) return no("no_message");
  if (lastMessage.from !== "guest") return no("host_turn");
  if (draft.messageId !== lastMessage.id) return no("newer_message");
  if (today > addDays(stay.checkOut, GRACE_DAYS)) return no("stay_ended");
  return { sendable: true, reason: null };
}
