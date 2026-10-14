#!/usr/bin/env node
/**
 * Fake iCal calendars for trying the installer: a tiny local server with an
 * Airbnb, a Booking and a Vrbo calendar whose stays move with today's date.
 * Everything is invented. Used by the installer check in CI and for the
 * screenshots of docs/installa.md.
 *
 *   node installa/prova/calendari-finti.mjs [port]     (default 8765)
 *   → http://127.0.0.1:8765/airbnb.ics, /booking.ics, /vrbo.ics
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8765);

const day = (offset) => {
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  t.setUTCDate(t.getUTCDate() + offset);
  return t.toISOString().slice(0, 10).replaceAll("-", "");
};

const event = (uid, from, to, summary) =>
  ["BEGIN:VEVENT", `DTSTART;VALUE=DATE:${day(from)}`, `DTEND;VALUE=DATE:${day(to)}`, `UID:${uid}@calendari-finti.example`, `SUMMARY:${summary}`, "END:VEVENT"].join("\r\n");

const calendar = (events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fairnight//Calendari finti//IT", ...events, "END:VCALENDAR", ""].join("\r\n");

const CALENDARS = {
  "/airbnb.ics": calendar([
    event("airbnb-1", 2, 6, "Reserved"),
    event("airbnb-2", 9, 13, "Reserved"),
    event("airbnb-3", 24, 27, "Airbnb (Not available)"),
    event("airbnb-4", 40, 47, "Reserved"),
  ]),
  "/booking.ics": calendar([event("booking-1", 15, 18, "CLOSED - Not available"), event("booking-2", 30, 33, "CLOSED - Not available")]),
  "/vrbo.ics": calendar([event("vrbo-1", 19, 22, "Reserved - Ospite di prova"), event("vrbo-2", 60, 63, "Blocked")]),
};

createServer((req, res) => {
  const body = CALENDARS[new URL(req.url ?? "/", "http://localhost").pathname];
  if (body === undefined) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/calendar; charset=utf-8" }).end(body);
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`Calendari finti: http://127.0.0.1:${port}/airbnb.ics, /booking.ics, /vrbo.ics\n`);
});
