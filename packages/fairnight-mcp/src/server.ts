/**
 * Fairnight MCP server: nine read-only tools over a Fairnight folder (prices,
 * zone data, the deadlines of guest registration and the replies to guests
 * waiting for the host).
 *
 * Built like mador-mcp: every tool is declared read-only (no confirmation
 * prompts in Claude or ChatGPT), errors come back as text the model can act
 * on, and the tool list is declared as never changing.
 */
import { McpServer, fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { ConfigError, formatAmount } from "fairnight";
import { explainNight, getPrices, guestDeadlinesOf, guestRepliesOf, listListings, marketArea, nextGaps, occupancy, syncStatus, ToolError, type Folder } from "./data.js";

export const VERSION = "0.2.0";

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface ToolResult {
  text: string;
  data: Record<string, unknown>;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (folder: Folder, args: any) => ToolResult;
}

const LISTING = { type: "string", description: 'The listing name, as returned by list_listings (e.g. "seaview-loft").' };
const fmt = (n: number | null) => (n === null ? "—" : formatAmount(n));

export const TOOLS: Tool[] = [
  {
    name: "list_listings",
    title: "List listings",
    description:
      "Lists the host's listings with their name, currency, base price, default minimum stay, the channels of their calendars and when the calendars were last read. Call this first: the other tools need a listing name.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (folder) => {
      const data = listListings(folder);
      const lines = data.listings.map(
        (l) =>
          `- ${l.name} (${l.title}): ${"units" in l ? `room type of ${l.units} identical units, ` : ""}base ${fmt(l.basePrice)} ${l.currency}, minimum ${l.defaultMinStay} nights, calendars: ${l.calendars.join(", ") || "none"}, last read: ${l.lastSync ?? "never"}`,
      );
      return { text: `Today is ${data.today}.\n${lines.join("\n")}`, data };
    },
  },
  {
    name: "get_prices",
    title: "Get nightly prices",
    description:
      "Price and minimum stay of each night of a listing between two dates (both included). Reserved and blocked nights have no price. A room type of a small hotel (units > 1) has one price for all its units and also returns how many are free each night. Dates are YYYY-MM-DD, from today on; default: the next 14 nights. At most 366 days from today.",
    inputSchema: {
      type: "object",
      properties: {
        listing: LISTING,
        from: { type: "string", description: "First night, YYYY-MM-DD. Default: today." },
        to: { type: "string", description: "Last night, YYYY-MM-DD. Default: 13 days after from." },
      },
      required: ["listing"],
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const data = getPrices(folder, args);
      const free = (n: (typeof data.nights)[number]) => ("units" in n ? `, ${n.unitsFree} of ${n.units} rooms free` : "");
      const lines = data.nights.map((n) =>
        n.price === null ? `${n.date} ${n.weekday}: ${n.status}${free(n)}` : `${n.date} ${n.weekday}: ${fmt(n.price)} ${data.currency}, minimum ${n.minStay}${free(n)}`,
      );
      return { text: `${data.listing}, ${data.from} → ${data.to}:\n${lines.join("\n")}`, data };
    },
  },
  {
    name: "explain_night",
    title: "Explain one night",
    description:
      "Why a night of a listing has its price and minimum stay: every factor applied (season, weekday, last minute, gaps, occupancy, events, floors…) with the price before and after it. For a room type with several units it also says how many rooms are free and which rule weighed most. Use it when the host asks why a price is what it is.",
    inputSchema: {
      type: "object",
      properties: { listing: LISTING, date: { type: "string", description: "The night, YYYY-MM-DD, from today on." } },
      required: ["listing", "date"],
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const data = explainNight(folder, args);
      return { text: data.explanation, data };
    },
  },
  {
    name: "occupancy",
    title: "Occupancy of a month",
    description:
      "For one listing and one calendar month: nights reserved, blocked and free, the occupancy (reserved nights out of the nights not blocked), and the average price of the nights still for sale. For a room type with several units the occupancy counts room-nights (4 of 6 rooms booked = 4 of 6), a night is reserved or blocked only when no room is left, and roomNights gives the totals.",
    inputSchema: {
      type: "object",
      properties: { listing: LISTING, month: { type: "string", description: "The month, YYYY-MM." } },
      required: ["listing", "month"],
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const d = occupancy(folder, args);
      const rooms = d.roomNights
        ? `${d.listing}, ${d.month}, ${d.units} rooms: ${d.roomNights.reserved} of ${d.roomNights.total} room-nights reserved, ${d.roomNights.blocked} blocked, ${d.roomNights.free} free; ${d.reserved} nights sold out, ${d.blocked} closed`
        : null;
      const text =
        (rooms ?? `${d.listing}, ${d.month}: ${d.reserved} of ${d.nights} nights reserved, ${d.blocked} blocked, ${d.free} free`) +
        (d.occupancyPercent === null ? "" : ` (occupancy ${d.occupancyPercent}%)`) +
        (d.averagePriceForSale === null ? "." : `. ${d.stillForSale} nights still for sale, average ${fmt(d.averagePriceForSale)} ${d.currency}.`);
      return { text, data: d };
    },
  },
  {
    name: "next_gaps",
    title: "Next gaps between stays",
    description:
      "Short free stretches between two stays (or blocked dates) in the coming days: the nights that are hardest to sell. Returns each gap with its dates, length, prices and minimum stay. For a room type with several units a gap lies between two sold-out nights, and unitsFree says how many rooms are free on each of its nights.",
    inputSchema: {
      type: "object",
      properties: {
        listing: LISTING,
        days: { type: "integer", description: "How many days ahead to look. Default 90, at most 366." },
        maxNights: { type: "integer", description: "Longest stretch that counts as a gap. Default 3." },
      },
      required: ["listing"],
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const d = nextGaps(folder, args);
      const lines = d.gaps.map(
        (g) =>
          `- ${g.from} → ${g.to} (${g.nights} night${g.nights === 1 ? "" : "s"}): ${g.prices.map(fmt).join(", ")} ${d.currency}, minimum ${g.minStay ?? "—"}` +
          (g.unitsFree ? `, rooms free ${g.unitsFree.join(", ")} of ${d.units}` : ""),
      );
      const text = d.gaps.length
        ? `${d.listing}: ${d.gaps.length} gap${d.gaps.length === 1 ? "" : "s"} of up to ${d.maxNights} nights between ${d.from} and ${d.to}:\n${lines.join("\n")}`
        : `${d.listing}: no gaps of up to ${d.maxNights} nights between ${d.from} and ${d.to}.`;
      return { text, data: d };
    },
  },
  {
    name: "get_sync_status",
    title: "Where the data comes from",
    description:
      "For each listing: where its bookings come from (iCal calendars of Airbnb, Booking, Vrbo…, the Smoobu API or the Beds24 API), when each source was last read successfully, and the last error if the latest read failed. Use it when the host asks whether the data is up to date.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (folder) => {
      const data = syncStatus(folder);
      const lines = data.listings.map((l) => {
        const parts = l.sources.map((s) => {
          const label = s.kind === "smoobu" ? `Smoobu apartment ${s.apartmentId}` : s.kind === "beds24" ? `Beds24 room ${s.roomId}` : `${s.channel} iCal`;
          const when = s.lastSuccess ? `last read ${s.lastSuccess}` : "never read";
          return `${label}: ${when}${s.lastError ? ` (latest attempt failed: ${s.lastError})` : ""}`;
        });
        return `- ${l.listing} (data from ${l.dataFrom}): ${parts.join("; ") || "no sources"}`;
      });
      return { text: lines.join("\n"), data };
    },
  },
  {
    name: "get_market_area",
    title: "Zone data used by a listing",
    description:
      "The zone data behind the zone demand factor of a listing: its source and the attribution to quote (your own file, Inside Airbnb CC BY 4.0, Powered by AirROI with its link https://www.airroi.com), when it was read, how long it is kept, whether the occupancy is an estimate, the zone's average, and the zone's occupancy, average price and comparable listings for each night between two dates (default: the next 14). Also the factor's settings (on or off, weight, caps). Always quote the attribution when you use these figures.",
    inputSchema: {
      type: "object",
      properties: {
        listing: LISTING,
        from: { type: "string", description: "First night, YYYY-MM-DD. Default: today." },
        to: { type: "string", description: "Last night, YYYY-MM-DD. Default: 13 days after from." },
      },
      required: ["listing"],
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const d = marketArea(folder, args);
      const factor = d.factor?.enabled
        ? `zone demand on (weight ${d.factor.weight}, at most +${d.factor.maxRaisePercent}% / -${d.factor.maxLowerPercent}%)`
        : "zone demand off";
      if (d.zone === null) return { text: `${d.listing}: no zone set (marketArea), ${factor}. Prices use only the host's own data.`, data: d };
      if (d.data === null) return { text: `${d.listing}: zone "${d.zone}" has no data (none imported, or it expired), ${factor}. Prices are not changed by the zone.`, data: d };
      const z = d.data;
      const head =
        `${d.listing}: zone "${d.zone}", ${factor}. Source: ${z.attribution}, read ${z.readOn}` +
        (z.keptUntil ? `, kept until ${z.keptUntil}` : "") +
        `. ${z.nights} nights ${z.first} → ${z.last}` +
        (z.averageOccupancyPercent !== null ? `, average occupancy ${z.averageOccupancyPercent}%${z.estimated ? " (estimated: booked and closed nights look the same)" : ""}` : "") +
        (z.averagePrice !== null ? `, average price ${fmt(z.averagePrice)}` : "") +
        ".";
      const lines = d.nights.map(
        (n) =>
          `${n.date}: ${n.occupancyPercent !== undefined ? `${n.occupancyPercent}% booked` : "occupancy —"}` +
          `${n.averagePrice !== undefined ? `, price ${fmt(n.averagePrice)}` : ""}${n.comparables !== undefined ? `, ${n.comparables} comparables` : ""}`,
      );
      return { text: [head, ...(lines.length ? lines : [`No zone figures between ${d.from} and ${d.to}.`])].join("\n"), data: d };
    },
  },
  {
    name: "get_guest_deadlines",
    title: "Guest communications due",
    description:
      "Guest registration (Fairguest, Spain): for each stay, the communications to the police that are due (reservation within 24 hours of the booking, guests within 24 hours of check-in, and a cancellation when a communicated booking is cancelled), with the deadline and whether it is late. Only dates and states: guests' names and documents are encrypted and never returned. Use it when the host asks what is left to send.",
    inputSchema: {
      type: "object",
      properties: { includeDone: { type: "boolean", description: "Also list the communications already done. Default false." } },
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const d = guestDeadlinesOf(folder, args);
      if (!d.enabled) return { text: 'Guest registration (Fairguest) is not turned on in this folder ("fairnight ospiti attiva").', data: d };
      const label: Record<string, string> = { reservation: "reservation", checkin: "guests at check-in", cancellation: "cancellation" };
      const lines = d.deadlines.map(
        (r) =>
          `- ${r.state === "late" ? "LATE" : r.state}: ${label[r.communication]} for stay ${r.stay} (${r.listing}, ${r.checkIn} → ${r.checkOut}) to ${r.authority}, due ${r.due}` +
          (r.state === "done" ? `, done ${r.doneAt}` : `, ${r.guestsRegistered} guest${r.guestsRegistered === 1 ? "" : "s"} registered`),
      );
      const head = `Now ${d.now}. ${d.late} late.`;
      return { text: lines.length ? `${head}\n${lines.join("\n")}` : `${head} Nothing to communicate.`, data: d };
    },
  },
  {
    name: "get_guest_replies",
    title: "Replies to guests waiting",
    description:
      "The guest assistant (Fairhello): draft replies to guests waiting for the host's approval, with the listing, the dates of the stay, the guest's language, what to look at (price, money, complaint, cancellation, emergency) and whether each draft can still be sent (an outdated one has a reason: the guest wrote again, the host already answered…). Read only: approving and sending happen only on the host's page /risposte or with \"fairnight risposte invia\". Texts are returned only with includeText, and contain guests' messages: use them only to help the host answer.",
    inputSchema: {
      type: "object",
      properties: { includeText: { type: "boolean", description: "Also return the guest's last message and the draft. Default false." } },
      additionalProperties: false,
    },
    handler: (folder, args) => {
      const d = guestRepliesOf(folder, args);
      if (!d.enabled) return { text: 'The guest assistant (Fairhello) has not been used in this folder yet ("fairnight risposte leggi").', data: d };
      const lines = d.drafts.map(
        (r) =>
          `- #${r.draft} ${r.listing} ${r.checkIn} → ${r.checkOut}${r.language ? `, ${r.language}` : ""}: ${r.sendable ? "waiting for approval" : `outdated (${r.reason})`}` +
          (r.flags.length ? `, look at: ${r.flags.join(", ")}` : "") +
          (r.draftText !== undefined ? `\n  guest: ${r.guestMessage}\n  draft: ${r.draftText}` : ""),
      );
      const head = `Today ${d.today}. ${d.waiting} repl${d.waiting === 1 ? "y" : "ies"} waiting for approval, ${d.outdated} outdated.`;
      return { text: lines.length ? `${head}\n${lines.join("\n")}` : head, data: d };
    },
  },
];

export const INSTRUCTIONS = `Fairnight prices the host's short-term rental listings night by night, on the host's own computer.
Start with list_listings to get the listing names. Prices come from the host's rules and calendars; explain_night says why a night costs what it costs.
These tools only read: they never change prices, calendars or bookings. To change a price, the host edits fairnight.config.json.
Calendars are as fresh as the last "fairnight sync" (see lastSync). get_market_area shows the zone data a listing uses, if any: always quote its attribution. get_guest_replies lists the replies to guests waiting for the host; they are approved and sent only by the host, never from here. Answer in the host's language.`;

const errorResult = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export function buildServer(folder: Folder, onError: (e: unknown) => void = () => {}): McpServer {
  const server = new McpServer({ name: "fairnight", title: "Fairnight", version: VERSION }, { instructions: INSTRUCTIONS });
  // Before the tools: the tool list never changes during a session.
  server.server.registerCapabilities({ tools: { listChanged: false } });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType),
        annotations: { ...READ_ONLY_ANNOTATIONS, title: tool.title },
      },
      async (args) => {
        try {
          const result = tool.handler(folder, args ?? {});
          return { content: [{ type: "text" as const, text: result.text }], structuredContent: result.data };
        } catch (e) {
          if (e instanceof ToolError || e instanceof ConfigError) return errorResult(e.message);
          onError(e);
          return errorResult("Something went wrong while reading the Fairnight folder. Check the folder with \"fairnight price\".");
        }
      },
    );
  }
  return server;
}
