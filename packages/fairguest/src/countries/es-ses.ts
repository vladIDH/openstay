/**
 * Spain, SES.HOSPEDAJES (Ministerio del Interior).
 *
 * Validation, deadlines and retention are ready. The XML of the parte de
 * viajeros (PV) and of the reserva de hospedaje (RH) is NOT written yet: its
 * XSD schemas are published only inside the SES application. Until they are
 * downloaded (docs/registro-ospiti.md, section 7b) `prepare` refuses, so that
 * nothing invented can ever be sent.
 */
import { SPAIN_DOCUMENT_TYPES, spainDeadlines, spainRetention } from "../spain.js";
import { NotAvailableError, type Registry } from "../types.js";
import { guestRules, spainRules } from "../validate.js";

export const SES_NOT_READY =
  "SES.HOSPEDAJES: the XML for the web service is not written yet. It needs the Ministry's XSD schemas, which are published only inside the SES application " +
  "(see docs/registro-ospiti.md, section 7b: they go in the openstay-ses-docs folder, outside the repository). " +
  "Nothing was prepared and nothing was sent. Until then, enter the guests on the SES.HOSPEDAJES website and record it with \"fairnight ospiti inviato\".";

export const sesRegistry: Registry = {
  country: "ES",
  authority: "SES.HOSPEDAJES (Ministerio del Interior)",
  documentTypes: SPAIN_DOCUMENT_TYPES,
  validate: (stay, kind) => spainRules(stay, kind, 18),
  checkGuest: (g, i, checkIn) => guestRules(g, i, checkIn, 18, { skipMunicipalityCode: true }),
  deadlines: spainDeadlines,
  prepare() {
    throw new NotAvailableError(SES_NOT_READY);
  },
  retention: spainRetention,
};
