/**
 * The pieces of the command line that other tools (the MCP server) reuse to
 * read a Fairnight folder. Reading only: nothing here syncs or writes.
 */
export { feedKeys, loadHostConfig, selectListings, SetupError, unitsOf } from "./config.js";
export type { AirRoiArea, CalendarLink, HostConfig, HostListing, MarketSettings } from "./config.js";
export { openDbReadOnly } from "./db.js";
export { markLines, nightMarks } from "./pilota-conferme.js";
export type { Db } from "./db.js";
export { CONFIG_FILE, configPath, dbPath, localToday } from "./io.js";
export { listMarketAreas, loadMarket } from "./market-store.js";
export type { MarketAreaRow } from "./market-store.js";
export { lastBookingReceived, lastSync, loadPriceHistory, loadStays, priceOne } from "./price.js";
export { guestDeadlines, guestsEnabled } from "./guests/store.js";
export type { DeadlineRow } from "./guests/store.js";
export { conversation, flagsOf, helloTablesExist, lastRun, openDrafts, textToSend } from "./hello/store.js";
export type { DraftRow, DraftView, HelloStayRow, MessageRow } from "./hello/store.js";
