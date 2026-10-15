export * from "./types.js";
export { ALPHA3_TO_ALPHA2, countryNames, isCountryCode } from "./countries-iso.js";
export { addDays, addHours, addYears, ageOn, hoursBetween, isDate, isTime, localDateTime } from "./dates.js";
export { guestRules, isPaymentType, parseGuest, spainRules, validDni, validNie } from "./validate.js";
export type { ParsedGuest } from "./validate.js";
export {
  SPAIN_DOCUMENT_TYPES,
  CANCELLATION_HOURS,
  KINSHIP_CODES,
  PAYMENT_CODES,
  SES_DOCUMENT_CODES,
  SES_SEX_CODES,
  spainDeadlines,
  spainRetention,
} from "./spain.js";
export { SES_NOT_READY, sesRegistry } from "./countries/es-ses.js";
export { MOSSOS_PORTAL, mossosFile, mossosRegistry } from "./countries/es-mossos.js";
export {
  ALLOGGIATI_DOCUMENT_CODES,
  daysOfStay,
  fullSurname,
  italyDeadlines,
  italyGuestRules,
  italyRetention,
  italyRules,
  ITALY_DOCUMENT_TYPES,
  lodgerTypes,
  MAX_DAYS,
  RECEIPT_YEARS,
} from "./italy.js";
export {
  ALLOGGIATI_NEEDS_TABLES,
  ALLOGGIATI_PORTAL,
  ALLOGGIATI_SERVICE_URL,
  ALLOGGIATI_TABLE_URLS,
  AlloggiatiClient,
  AlloggiatiError,
  alloggiatiFile,
  alloggiatiRegistry,
  MAX_FILE_LINES,
  municipalityCode,
  parseAlloggiatiTables,
  placeKey,
  SCHEDINA_LENGTH,
  schedine,
  stateCode,
  xmlElement,
} from "./countries/it-alloggiati.js";
export type { AlloggiatiCredentials, AlloggiatiPlace, AlloggiatiTables, LinesOutcome, Lookup, ServiceOutcome } from "./countries/it-alloggiati.js";
export { changePassphrase, createKeys, DEFAULT_SCRYPT, open, PassphraseError, passphraseProblem, publicKeyOf, seal, SealError, unlock } from "./crypto.js";
export type { KeyRecord, ScryptParams } from "./crypto.js";
export { DEFAULT_ALLOGGIATI_ACCOUNT, SETTINGS_FIELDS, validateGuestSettings } from "./settings.js";
export type { AlloggiatiSettings, GuestSettings, IstatSettings } from "./settings.js";

export { registryFor } from "./registry.js";
export { LANGS, pickLang, WORDS } from "./form/words.js";
export type { Lang, Words } from "./form/words.js";
export { errorsByField, esc, FORM_KEYS, guestInput, LOCK, page, renderForm, stayDay, stepsBar, STYLE, TICK } from "./form/render.js";
export type { FormState } from "./form/render.js";
export { checkDigit, findMrzLines, guestFromMrz, parseMrz } from "./mrz.js";
export type { MrzFields, MrzFormat } from "./mrz.js";
export { fromBase64url, hasWebX25519, padded, rawPublicKey, toBase64url, webSeal } from "./web-seal.js";
export type { X25519Fallback } from "./web-seal.js";
export { BOX_ID, linkFor, readLinkFragment, relayPlace } from "./link.js";
export type { LinkPayload } from "./link.js";
export { ISTAT_REGION_KEYS, ISTAT_REGIONS, ROSS_PRODUCT } from "./istat/regions.js";
export type { IstatMode, IstatRegion, IstatRegionKey } from "./istat/regions.js";
export { istatStay, residenceProblems } from "./istat/record.js";
export type { IstatGuest, IstatStay } from "./istat/record.js";
export { NOT_SPECIFIED_TOURISM, NOT_SPECIFIED_TRANSPORT, Ross1000Client, rossFile } from "./istat/ross1000.js";
export type { RossDay, RossOutcome } from "./istat/ross1000.js";
export { dayFigures, monthSummary, provenance, PROVINCES, trentoCsv, umbriaDay } from "./istat/files.js";
