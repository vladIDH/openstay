/**
 * Zone data for Fairnight, read by adapters outside the engine: the host's own
 * CSV file, the Inside Airbnb files the host downloads, the AirROI API with the
 * host's own key. Nothing here scrapes a website.
 */
export { CsvRecords, guessSeparator, readCsv } from "./csv-records.js";
export { isIsoDay, parseAmount, parseMarketCsv } from "./csv.js";
export type { MarketCsvIssue, MarketCsvResult } from "./csv.js";
export {
  INSIDE_AIRBNB_ATTRIBUTION,
  INSIDE_AIRBNB_ESTIMATE_NOTE,
  InsideAirbnbCalendar,
  InsideAirbnbError,
  InsideAirbnbListings,
  insideAirbnbMarket,
} from "./insideairbnb.js";
export type { ComparableFilter, InsideAirbnbSummary } from "./insideairbnb.js";
export { AIRROI_ATTRIBUTION, AIRROI_BASE_URL, AIRROI_MAX_DAYS, AirRoiClient, AirRoiError, monthlyToDays } from "./airroi.js";
export type { AirRoiClientOptions, AirRoiFilter, AirRoiMarket, FetchLike, MarketSearchEntry, MonthlyMetrics } from "./airroi.js";
export { getText, OpenDataError, plainName } from "./http.js";
export type { OpenDataOptions } from "./http.js";
export {
  describeIstacBand,
  isIstacMunicipality,
  ISTAC_ATTRIBUTION,
  ISTAC_BANDS,
  ISTAC_BASE_URL,
  ISTAC_DATASET,
  istacBand,
  IstacClient,
  istacToDays,
  parseIstacAdrCsv,
} from "./istac.js";
export type { IstacAdr, IstacBand, IstacClientOptions, IstacMonth } from "./istac.js";
export { INE_ATTRIBUTION, INE_BASE_URL, INE_TABLE, IneClient, inePoints, ineToDays, parseIneTable } from "./ine.js";
export type { IneClientOptions, IneMonth, IneTouristPoint } from "./ine.js";
