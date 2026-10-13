export * from "./types.js";
export { ALPHA3_TO_ALPHA2, countryNames, isCountryCode } from "./countries-iso.js";
export { addDays, addHours, addYears, ageOn, hoursBetween, isDate, isTime, localDateTime } from "./dates.js";
export { guestRules, isPaymentType, parseGuest, spainRules, validDni, validNie } from "./validate.js";
export type { ParsedGuest } from "./validate.js";
export {
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
export { changePassphrase, createKeys, DEFAULT_SCRYPT, open, PassphraseError, passphraseProblem, publicKeyOf, seal, SealError, unlock } from "./crypto.js";
export type { KeyRecord, ScryptParams } from "./crypto.js";
export { SETTINGS_FIELDS, validateGuestSettings } from "./settings.js";
export type { GuestSettings } from "./settings.js";

import { mossosRegistry } from "./countries/es-mossos.js";
import { sesRegistry } from "./countries/es-ses.js";
import type { Country, Registry } from "./types.js";

/** The registry of a country. */
export function registryFor(country: Country): Registry {
  return country === "ES-CT" ? mossosRegistry : sesRegistry;
}
