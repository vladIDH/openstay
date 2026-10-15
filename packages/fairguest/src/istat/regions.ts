/**
 * Where the Istat tourist movement (arrivals and nights) goes, territory by
 * territory, and how. Read on 15 October 2026 on the official pages of the
 * regions and provinces and in the portals' manuals; see docs/fairguest-italia.md.
 *
 * - "ross1000": the GIES web service (SOAP, inviaMovimentazione), documented in
 *   "Tracciato record di integrazione dati (XML)", version 3 of 18/03/2026; the
 *   endpoints are those of its list. The same XML can be uploaded by hand.
 * - "trento-file": the CSV of ISTATalloggi (specification of 30/09/2024), to upload.
 *   Its web service needs a software-house account requested by PEC: not used.
 * - "umbria-file": the daily text file of the C/59 print, to upload on Turismatica.
 * - "alloggiati-file": Puglia's SPOT Easy takes the Alloggiati Web file.
 * - "manual": no file or service published; Fairguest prints the month's figures.
 */
export type IstatMode = "ross1000" | "trento-file" | "umbria-file" | "alloggiati-file" | "manual";

export interface IstatRegion {
  name: string;
  portal: string;
  mode: IstatMode;
  /** ROSS1000 web service, without "?wsdl". */
  endpoint?: string;
  deadline: string;
}

export const ISTAT_REGIONS = {
  piemonte: { name: "Piemonte", portal: "https://piemontedatiturismo.regione.piemonte.it", mode: "ross1000", endpoint: "https://piemontedatiturismo.regione.piemonte.it/ws/checkinV2", deadline: "by the 10th of the next month" },
  lombardia: { name: "Lombardia", portal: "https://www.flussituristici.servizirl.it/Turismo5/", mode: "ross1000", endpoint: "https://www.flussituristici.servizirl.it/Turismo5/app/ws/checkinV2", deadline: "by the 5th of the next month" },
  liguria: { name: "Liguria", portal: "https://ross1000-spid.regione.liguria.it", mode: "ross1000", endpoint: "https://turismows.regione.liguria.it/ws/checkinV2", deadline: "by the 7th of the next month" },
  "emilia-romagna": { name: "Emilia-Romagna", portal: "https://datiturismo.regione.emilia-romagna.it", mode: "ross1000", endpoint: "https://datiturismo.regione.emilia-romagna.it/ws/checkinV2", deadline: "by the 5th of the next month" },
  veneto: { name: "Veneto", portal: "https://flussituristici.regione.veneto.it", mode: "ross1000", endpoint: "https://flussituristici.regione.veneto.it/ws/checkinV2", deadline: "within 10 working days of the end of the month" },
  "toscana-fi-po-pt": { name: "Toscana (Firenze, Prato, Pistoia)", portal: "https://toscanaturismo.ross1000.it/turismo5-web", mode: "ross1000", endpoint: "https://toscanaturismo.ross1000.it/turismo5-web/ws/checkinV2", deadline: "by the 5th of the next month" },
  marche: { name: "Marche", portal: "https://istrice-ross1000.turismo.marche.it", mode: "ross1000", endpoint: "https://istrice-ross1000.turismo.marche.it/ws/checkinV2", deadline: "by the 5th of the next month" },
  lazio: { name: "Lazio", portal: "https://lazioturismo.ross1000.it", mode: "ross1000", endpoint: "https://lazioturismo.ross1000.it/ws/checkinV2", deadline: "within the month after the arrival" },
  abruzzo: { name: "Abruzzo", portal: "https://app.regione.abruzzo.it/Turismo5", mode: "ross1000", endpoint: "https://app.regione.abruzzo.it/Turismo5/ws/checkinV2", deadline: "by the 10th of the next month" },
  molise: { name: "Molise", portal: "https://moliseturismo.ross1000.it", mode: "ross1000", endpoint: "https://moliseturismo.ross1000.it/ws/checkinV2", deadline: "monthly [NV]" },
  calabria: { name: "Calabria", portal: "https://sirdat.regione.calabria.it", mode: "ross1000", endpoint: "https://sirdat.regione.calabria.it/ws/checkinV2", deadline: "monthly [NV]" },
  sardegna: { name: "Sardegna", portal: "https://sardegnaturismo.ross1000.it", mode: "ross1000", endpoint: "https://sardegnaturismo.ross1000.it/ws/checkinV2", deadline: "within 24 hours" },
  basilicata: { name: "Basilicata", portal: "https://sist-aptbasilicata.turitweb.it", mode: "ross1000", endpoint: "https://sist-aptbasilicata.turitweb.it/ws/checkinV1", deadline: "by the 10th of the next month [NV]" },
  trento: { name: "Provincia autonoma di Trento", portal: "https://statweb.provincia.tn.it/istatAlloggi", mode: "trento-file", deadline: "within 48 hours of arrival" },
  umbria: { name: "Umbria", portal: "https://turismatica.regione.umbria.it", mode: "umbria-file", deadline: "by the 5th of the next month" },
  puglia: { name: "Puglia", portal: "https://dms.puglia.it (SPOT Easy)", mode: "alloggiati-file", deadline: "by the 10th of the next month" },
  "valle-d-aosta": { name: "Valle d'Aosta", portal: "https://locazionituristiche.regione.vda.it", mode: "manual", deadline: "by the 5th of the next month" },
  "friuli-venezia-giulia": { name: "Friuli Venezia Giulia", portal: "https://servizistatistici.regione.fvg.it/webtur", mode: "manual", deadline: "monthly [NV]" },
  bolzano: { name: "Provincia autonoma di Bolzano", portal: "TM Light (LTS)", mode: "manual", deadline: "every day" },
  toscana: { name: "Toscana (other provinces)", portal: "the province's portal (MoTourist / RiceStat)", mode: "manual", deadline: "by the 5th of the next month" },
  campania: { name: "Campania", portal: "https://turismo.regione.campania.it/turismoweb", mode: "manual", deadline: "monthly [NV]" },
  sicilia: { name: "Sicilia", portal: "https://osservatorioturistico.regione.sicilia.it", mode: "manual", deadline: "daily, consolidated by the 5th of the next month" },
} as const satisfies Record<string, IstatRegion>;

export type IstatRegionKey = keyof typeof ISTAT_REGIONS;
export const ISTAT_REGION_KEYS = Object.keys(ISTAT_REGIONS) as IstatRegionKey[];

/** Product name sent in <prodotto>: the software that made the file. */
export const ROSS_PRODUCT = "Fairguest (OpenStay)";
