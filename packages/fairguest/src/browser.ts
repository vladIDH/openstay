/**
 * What the guest's browser needs, without anything of Node.js: the rules, the
 * form, sealing with Web Crypto and the MRZ reading. The relay's page is built
 * from this entry point only.
 */
export * from "./types.js";
export { countryNames, isCountryCode } from "./countries-iso.js";
export { isDate, localDateTime } from "./dates.js";
export { isPaymentType, parseGuest } from "./validate.js";
export { registryFor } from "./registry.js";
export { LANGS, pickLang, WORDS } from "./form/words.js";
export type { Lang, Words } from "./form/words.js";
export { errorsByField, esc, FORM_KEYS, guestInput, LOCK, renderForm, stayDay, stepsBar, STYLE, TICK } from "./form/render.js";
export type { FormState } from "./form/render.js";
export { formValuesFromMrz, guestFromMrz, parseMrz } from "./mrz.js";
export type { MrzFields } from "./mrz.js";
export { padded, webSeal } from "./web-seal.js";
export type { X25519Fallback } from "./web-seal.js";
export { BOX_ID, linkFor, readLinkFragment, relayPlace } from "./link.js";
export type { LinkPayload } from "./link.js";
export { residenceProblems } from "./istat/record.js";
export { isStripePayUrl, payCard } from "./form/pay.js";
export type { PayItem, PayView } from "./form/pay.js";
export { esMunicipalities, esMunicipalityByCode, findEsMunicipality, normalizePlace, sesMunicipalityCode } from "./countries/es-municipalities.js";
export type { Municipality, MunicipalityMatch } from "./countries/es-municipalities.js";
