/**
 * The pieces of the command line that other tools (the MCP server) reuse to
 * read a Fairnight folder. Reading only: nothing here syncs or writes.
 */
export { feedKeys, loadHostConfig, selectListings, SetupError } from "./config.js";
export type { CalendarLink, HostConfig, HostListing } from "./config.js";
export { openDbReadOnly } from "./db.js";
export type { Db } from "./db.js";
export { CONFIG_FILE, configPath, dbPath, localToday } from "./io.js";
export { lastBookingReceived, lastSync, loadPriceHistory, loadStays, priceOne } from "./price.js";
export { guestDeadlines, guestsEnabled } from "./guests/store.js";
export type { DeadlineRow } from "./guests/store.js";
