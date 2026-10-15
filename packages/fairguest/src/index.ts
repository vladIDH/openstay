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
export type { AlloggiatiSettings, GuestSettings } from "./settings.js";

import { mossosRegistry } from "./countries/es-mossos.js";
import { sesRegistry } from "./countries/es-ses.js";
import { alloggiatiRegistry } from "./countries/it-alloggiati.js";
import type { Country, Registry } from "./types.js";

const REGISTRIES: Record<Country, Registry> = { ES: sesRegistry, "ES-CT": mossosRegistry, IT: alloggiatiRegistry };

/** The registry of a country. */
export function registryFor(country: Country): Registry {
  return REGISTRIES[country];
}
