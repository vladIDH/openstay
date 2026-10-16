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
export { checkDigit, findMrzLines, formValuesFromMrz, guestFromMrz, parseMrz } from "./mrz.js";
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
export { classifyGuest, formatCents, isTaxClass, nightRateCents, nightsOf, periodRange, stayTax, TAX_CLASSES, TAX_PERIODS, validateTaxRule } from "./tax/rules.js";
export type { StayTax, StayTaxNight, TaxClass, TaxComponent, TaxPeriod, TaxRule, TaxSeason, TaxSource } from "./tax/rules.js";
export { TAX_PLACES, taxRuleFor } from "./tax/places.js";
export type { TaxPlace } from "./tax/places.js";
export { summaryCsv, summaryPdf, taxSummary } from "./tax/summary.js";
export type { SummaryLang, SummaryRow, SummaryStay, TaxSummary } from "./tax/summary.js";
export { pdfFile, textWidth } from "./tax/pdf.js";
export type { PdfText } from "./tax/pdf.js";
export { isStripePayUrl, money, PAY_WORDS, payCard } from "./form/pay.js";
export type { PayItem, PayView } from "./form/pay.js";
export { DEFAULT_DEPOSIT_DAYS_BEFORE } from "./settings.js";
export type { PaymentSettings } from "./settings.js";
export { bandKey, bandOf, bandRateCents, isReduced } from "./tax/rules.js";
export type { TaxAgeBand, TaxVerify } from "./tax/rules.js";
export { verifyTexts } from "./tax/verify.js";
export type { VerifyLang, VerifyText } from "./tax/verify.js";
export { esMunicipalities, esMunicipalityByCode, findEsMunicipality, normalizePlace, sesMunicipalityCode } from "./countries/es-municipalities.js";
export type { Municipality, MunicipalityMatch } from "./countries/es-municipalities.js";
