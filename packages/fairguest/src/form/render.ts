/**
 * The check-in form «Carta», as HTML strings: the same code draws the form
 * served on the host's own network (fairnight serve) and the one of the link
 * that works from anywhere (fairguest-relay), so both look and ask the same.
 * No Node.js and no browser API in here: plain strings in, plain strings out.
 */
import { countryNames } from "../countries-iso.js";
import { esMunicipalities, findEsMunicipality } from "../countries/es-municipalities.js";
import { registryFor } from "../registry.js";
import { KINSHIPS, PAYMENT_TYPES, SEXES, type Country, type Problem } from "../types.js";
import { LANGS, WORDS, type Lang, type Words } from "./words.js";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
export const STYLE = `
:root{color-scheme:light;--bg:#f6f4ef;--card:#fffdf9;--ink:#1d2024;--muted:#555c63;--line:#e3ded4;--field:#c9c2b5;--input:#fff;--accent:#24507a;--on-accent:#fff;--soft:#e9eef3;--bad:#a3262e;--bad-bg:#fdf3f3;--ok:#1e6b3a;--ok-bg:#e6f1e9}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#171512;--card:#211e1a;--ink:#f1ede6;--muted:#b9b1a5;--line:#36312a;--field:#5b5349;--input:#1b1916;--accent:#8db8e3;--on-accent:#10161c;--soft:#25303a;--bad:#ff9b94;--bad-bg:#3a2222;--ok:#8fd4a5;--ok-bg:#1f3326}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:600px;margin:0 auto;padding:18px 16px 32px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
h1{font-size:1.4rem;line-height:1.2;margin:4px 0 12px}
nav{display:flex;gap:4px 10px;flex-wrap:wrap;justify-content:flex-end;font-size:.9rem;padding-top:6px}
nav a{color:var(--muted);text-decoration:none}nav a[aria-current]{color:var(--ink);font-weight:700}
nav a:focus-visible,a.button:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.stay{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.stay b{display:block;font-size:1.05rem}.stay span{color:var(--muted);font-size:.95rem}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:16px 0 4px;padding:0;list-style:none;font-size:.82rem;color:var(--muted)}
.steps li{border-top:4px solid var(--line);padding-top:6px}
.steps li.done{border-color:var(--accent)}.steps li[aria-current]{border-color:var(--accent);color:var(--ink);font-weight:700}
.privacy-line{display:flex;gap:9px;align-items:flex-start;background:var(--soft);border-radius:12px;padding:10px 12px;margin:12px 0 4px;font-size:.92rem}
.privacy-line svg{flex:none;margin-top:3px;color:var(--accent)}
.privacy-line .where{display:block;margin-top:4px}
.intro{color:var(--muted);font-size:.95rem}
h2{font-size:1.15rem;margin:22px 0 6px}
.step{margin:14px 0}
.step h3{display:flex;align-items:center;gap:10px;font-size:1.1rem;margin:0 0 8px}
.n{flex:none;width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--on-accent);font-size:.9rem;display:grid;place-items:center}
fieldset{border:1px solid var(--line);border-radius:16px;background:var(--card);margin:10px 0;padding:6px 16px 16px;min-width:0}
legend{font-weight:700;padding:0 6px;font-size:1rem}
label{display:block;margin-top:14px;font-weight:600;font-size:.95rem}
input,select{display:block;width:100%;max-width:100%;min-width:0;margin-top:5px;padding:12px 13px;border:1.5px solid var(--field);border-radius:12px;font:inherit;background:var(--input);color:var(--ink);min-height:48px}
input:focus,select:focus{outline:3px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
input[type=checkbox]{display:inline;width:22px;height:22px;min-height:0;margin:0 10px 0 0;vertical-align:-5px;accent-color:var(--accent)}
.check{font-weight:400}
.hint{display:block;font-weight:400;color:var(--muted);font-size:.85rem;margin-top:2px}
.err{color:var(--bad);font-size:.9rem;font-weight:600;margin-top:6px}
.has-err input,.has-err select{border-color:var(--bad);background:var(--bad-bg)}
.banner{border-radius:12px;padding:12px 14px;margin:14px 0;font-weight:600}.banner.bad{background:var(--bad-bg);color:var(--bad)}
button,.button{display:block;width:100%;text-align:center;margin-top:18px;padding:15px 18px;border:0;border-radius:14px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.done-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 18px;margin:16px 0;text-align:center}
.done-card .tick{width:56px;height:56px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center;margin:0 auto 10px}
.done-card h2{margin:4px 0}.done-card p{color:var(--muted);margin:6px 0 0}
details.another>summary{list-style:none;display:block;text-align:center;margin-top:6px;padding:14px 18px;border-radius:14px;border:1.5px solid var(--accent);color:var(--accent);font-weight:700;cursor:pointer}
details.another>summary::-webkit-details-marker{display:none}
details.another[open]>summary{display:none}
.privacy{font-size:.85rem;color:var(--muted);margin-top:22px}
.message{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:12px}
@media (max-width:480px){.top{flex-direction:column-reverse;gap:2px}nav{align-self:flex-end;padding-top:0}}
`;

export function page(lang: Lang, title: string, body: string, nonce: string, langLink?: (l: Lang) => string): string {
  const nav = langLink
    ? `<nav>${LANGS.map((l) => `<a href="${esc(langLink(l))}" hreflang="${l}"${l === lang ? ' aria-current="true"' : ""}>${WORDS[l].langName}</a>`).join("")}</nav>`
    : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head><body><main><header class="top"><h1>${esc(title)}</h1>${nav}</header>${body}</main></body></html>`;
}

export const LOCK = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z"/></svg>`;
export const TICK = `<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/** The three steps at the top; `at` is the current one (1 details, 2 document, 3 confirmation). */
export function stepsBar(w: Words, at: 1 | 2 | 3): string {
  const names = [w.steps.data, w.steps.document, w.steps.confirm];
  return `<ol class="steps" aria-label="${esc(w.stepLabel(at))}">${names
    .map((name, i) => `<li${i + 1 === at ? ' aria-current="step"' : i + 1 < at ? ' class="done"' : ""}>${i + 1} · ${esc(name)}</li>`)
    .join("")}</ol>`;
}

/** A day of the stay in the guest's language, like "10 giugno 2099". */
export function stayDay(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Which form field a problem belongs to. */
function fieldOf(path: string): string {
  const rest = path.replace(/^guests?(\[\d+\])?\.?/, "");
  const map: Record<string, string> = {
    "": "phone",
    "document": "docType",
    "document.type": "docType",
    "document.number": "docNumber",
    "document.support": "docSupport",
    "document.issuedOn": "docIssued",
    "document.issuedIn": "docCountry",
    "document.issuedIn.country": "docCountry",
    "document.issuedIn.locality": "docPlace",
    "document.issuedIn.province": "docProvince",
    "birthPlace": "birthCountry",
    "birthPlace.country": "birthCountry",
    "birthPlace.locality": "birthPlace",
    "birthPlace.province": "birthProvince",
    "address": "country",
    "address.country": "country",
    "address.street": "street",
    "address.postalCode": "postalCode",
    "address.locality": "locality",
    "address.municipalityCode": "locality",
    "address.province": "province",
    phone2: "phone",
  };
  return map[rest] ?? rest;
}

export function errorsByField(problems: Problem[], w: Words): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of problems) {
    const field = fieldOf(p.path);
    if (out.has(field)) continue;
    const contact = p.message.startsWith("at least one phone");
    // Problems about the whole guest land on "phone"; only the missing contact belongs there
    // (a missing name is already shown on the name fields).
    if (field === "phone" && !contact && !p.path.endsWith("phone")) continue;
    const required = /required|missing/.test(p.message);
    const municipality = p.path.endsWith("address.municipalityCode");
    out.set(field, contact ? w.contactMissing : municipality ? (w.invalidFor.municipality as string) : required ? w.required : (w.invalidFor[field] ?? w.invalid));
  }
  return out;
}

export interface FormState {
  values: Record<string, string>;
  errors: Map<string, string>;
}

/** `residence`: in Italy, asked only when the listing sends Istat data. */
export function renderForm(w: Words, lang: Lang, country: Country, action: string, tok: string, registered: number, state: FormState, options: { residence?: boolean } = {}): string {
  const v = (k: string) => esc(state.values[k] ?? "");
  const err = (k: string) => (state.errors.has(k) ? `<div class="err" id="${k}-err">${esc(state.errors.get(k) as string)}</div>` : "");
  const cls = (k: string) => (state.errors.has(k) ? ' class="has-err"' : "");
  const input = (k: string, type = "text", extra = "") =>
    `<div${cls(k)}><label for="${k}">${esc(w.fields[k] as string)}${w.hints[k] ? ` <span class="hint">${esc(w.hints[k] as string)}</span>` : ""}</label><input id="${k}" name="${k}" type="${type}" value="${v(k)}" ${extra}${state.errors.has(k) ? ` aria-invalid="true" aria-describedby="${k}-err"` : ""}>${err(k)}</div>`;
  const select = (k: string, options: [string, string][], hint?: string) =>
    `<div${cls(k)}><label for="${k}">${esc(w.fields[k] as string)}${hint ? ` <span class="hint">${esc(hint)}</span>` : ""}</label><select id="${k}" name="${k}"><option value="">${esc(w.choose)}</option>${options
      .map(([val, label]) => `<option value="${esc(val)}"${state.values[k] === val ? " selected" : ""}>${esc(label)}</option>`)
      .join("")}</select>${err(k)}</div>`;
  const countries = countryNames(lang).map((c): [string, string] => [c.code, c.name]);
  const first = registered === 0;
  const documentTypes = registryFor(country).documentTypes.map((d): [string, string] => [d, w.documentTypes[d]]);
  if (country === "IT") return renderItalianForm(w, lang, action, tok, first, registered, state, { input, select, countries, documentTypes }, options.residence === true);
  // Step 1: the person, where they live, how to reach them. Step 2: the document (and, for the holder, the payment).
  return `<form method="post" action="${esc(action)}" autocomplete="off" id="form">
<input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="lang" value="${lang}">
<h2>${esc(first ? w.firstGuest : w.nextGuest(registered + 1))}</h2>
<section class="step"><h3><span class="n">1</span>${esc(w.steps.data)}</h3>
<fieldset><legend>${esc(w.sections.person)}</legend>
${input("givenName", "text", 'maxlength="50" required autocomplete="given-name"')}${input("surname1", "text", 'maxlength="50" required')}${input("surname2", "text", 'maxlength="50"')}
${input("birthDate", "date")}
${select("sex", SEXES.map((s) => [s, w.sex[s]]))}
${select("nationality", countries)}
${first ? "" : select("kinship", KINSHIPS.map((k) => [k, w.kinship[k]]), w.hints.kinship)}
</fieldset>
<fieldset><legend>${esc(w.sections.address)}</legend>
${select("country", countries)}${input("street", "text", 'maxlength="100"')}${input("postalCode", "text", 'maxlength="20" inputmode="numeric"')}${townField(w, state)}
</fieldset>
<fieldset><legend>${esc(w.sections.contact)}</legend><p class="hint">${esc(w.hints.contact as string)}</p>
${input("phone", "tel", 'maxlength="20" inputmode="tel"')}${input("email", "email", 'maxlength="100" inputmode="email"')}
</fieldset>
</section>
<section class="step"><h3><span class="n">2</span>${esc(w.steps.document)}</h3>
<fieldset><legend>${esc(w.sections.document)}</legend>
${select("docType", documentTypes)}
${input("docNumber", "text", 'maxlength="20" autocapitalize="characters"')}${input("docSupport", "text", 'maxlength="9" autocapitalize="characters"')}${input("docIssued", "date")}
<label class="check"><input type="checkbox" name="docSpanish" value="1"${state.values.docSpanish ? " checked" : ""}>${esc(w.fields.docSpanish as string)}</label>
</fieldset>
${first ? `<fieldset><legend>${esc(w.sections.payment)}</legend>${select("payment", PAYMENT_TYPES.map((p) => [p, w.payment[p]]))}<p class="hint">${esc(w.paymentNote)}</p></fieldset>` : ""}
</section>
<button type="submit">${esc(w.save)}</button>
</form>`;
}

let townList: string | null = null;

/** Every Spanish municipality as a suggestion of the town field: plain HTML, it works without JavaScript too. */
function townOptions(): string {
  townList ??= `<datalist id="es-towns">${esMunicipalities()
    .map((m) => `<option value="${esc(m.label)}">`)
    .join("")}</datalist>`;
  return townList;
}

/** The town of residence: in Spain the municipality, picked from the INE's list by its name; abroad, free text. */
function townField(w: Words, state: FormState): string {
  const k = "locality";
  const bad = state.errors.has(k);
  return `<div${bad ? ' class="has-err"' : ""}><label for="${k}">${esc(w.fields.town as string)} <span class="hint">${esc(w.hints.town as string)}</span></label><input id="${k}" name="${k}" type="text" value="${esc(state.values[k] ?? "")}" maxlength="100" list="es-towns" autocomplete="off"${bad ? ` aria-invalid="true" aria-describedby="${k}-err"` : ""}>${bad ? `<div class="err" id="${k}-err">${esc(state.errors.get(k) as string)}</div>` : ""}${townOptions()}</div>`;
}

interface Controls {
  input(k: string, type?: string, extra?: string): string;
  select(k: string, options: [string, string][], hint?: string): string;
  countries: [string, string][];
  documentTypes: [string, string][];
}

/**
 * Italy (Alloggiati Web): who the person is and where they were born; the
 * document only for the holder. No address, contact or payment: the law does
 * not ask for them, so the form does not either.
 */
function renderItalianForm(w: Words, lang: Lang, action: string, tok: string, first: boolean, registered: number, state: FormState, c: Controls, residence: boolean): string {
  const hint = (k: string, text: string) => c.input(k, "text", 'maxlength="60"').replace(`${esc(w.fields[k] as string)}</label>`, `${esc(w.fields[k] as string)} <span class="hint">${esc(text)}</span></label>`);
  const province = (k: string) => c.input(k, "text", 'maxlength="2" autocapitalize="characters" size="2"');
  const sexes = SEXES.filter((x) => x !== "other").map((x): [string, string] => [x, w.sex[x]]);
  const surname = c.input("surname1", "text", 'maxlength="50" required').replace(`>${esc(w.fields.surname1 as string)}</label>`, `>${esc(w.italy.surname)}</label>`);
  return `<form method="post" action="${esc(action)}" autocomplete="off" id="form">
<input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="lang" value="${lang}">
<h2>${esc(first ? w.firstGuest : w.nextGuest(registered + 1))}</h2>
<section class="step"><h3><span class="n">1</span>${esc(w.steps.data)}</h3>
<fieldset><legend>${esc(w.sections.person)}</legend>
${c.input("givenName", "text", 'maxlength="30" required autocomplete="given-name"')}${surname}
${c.input("birthDate", "date")}
${c.select("sex", sexes)}
${c.select("nationality", c.countries)}
${first ? "" : c.select("kinship", KINSHIPS.map((k) => [k, w.kinship[k]]), w.italy.kinshipHint)}
</fieldset>
<fieldset><legend>${esc(w.italy.birthSection)}</legend>
${c.select("birthCountry", c.countries)}${hint("birthPlace", w.italy.birthPlaceHint)}${province("birthProvince")}
</fieldset>
${
  residence
    ? `<fieldset><legend>${esc(w.italy.residenceSection)}</legend>
${c.select("country", c.countries)}${hint("locality", w.italy.residenceHint)}${province("province")}
</fieldset>`
    : ""
}
</section>
<section class="step"><h3><span class="n">2</span>${esc(w.steps.document)}</h3>
${
  first
    ? `<fieldset><legend>${esc(w.sections.document)}</legend>
${c.select("docType", c.documentTypes)}
${c.input("docNumber", "text", 'maxlength="20" autocapitalize="characters"').replace(/ <span class="hint">[^<]*<\/span>/, "")}
${c.select("docCountry", c.countries)}${hint("docPlace", w.italy.docPlaceHint)}${province("docProvince")}
</fieldset>`
    : `<p class="message">${esc(w.italy.noDocument)}</p>`
}
</section>
<button type="submit">${esc(w.save)}</button>
</form>`;
}

/**
 * The address as posted. In Spain the town is looked up in the INE's list: when
 * it is a municipality (the postal code tells apart towns of the same name),
 * its INE code goes with it and the name becomes the INE's. Otherwise no code,
 * and the rules ask the guest to pick the municipality from the list.
 */
function addressInput(country: string, street: string, postalCode: string, locality: string, province: string): Record<string, string> {
  const address = { country, street, postalCode, locality, province };
  if (country.trim().toUpperCase() !== "ESP" || !locality.trim()) return address;
  const found = findEsMunicipality(locality, postalCode.trim());
  if (!("municipality" in found)) return address;
  return { ...address, locality: found.municipality.name, municipalityCode: found.municipality.code };
}

/** The guest object from the posted form; unknown fields are never read. */
export function guestInput(f: URLSearchParams): Record<string, unknown> {
  const g = (k: string) => f.get(k) ?? "";
  return {
    givenName: g("givenName"),
    surname1: g("surname1"),
    surname2: g("surname2"),
    birthDate: g("birthDate"),
    sex: g("sex"),
    nationality: g("nationality"),
    kinship: g("kinship"),
    birthPlace: { country: g("birthCountry"), locality: g("birthPlace"), province: g("birthProvince") },
    document: {
      type: g("docType"),
      number: g("docNumber"),
      support: g("docSupport"),
      issuedOn: g("docIssued"),
      spanish: f.get("docSpanish") === "1" && g("docType") === "passport",
      issuedIn: { country: g("docCountry"), locality: g("docPlace"), province: g("docProvince") },
    },
    address: addressInput(g("country"), g("street"), g("postalCode"), g("locality"), g("province")),
    phone: g("phone"),
    email: g("email"),
  };
}

export const FORM_KEYS = [
  "givenName",
  "surname1",
  "surname2",
  "birthDate",
  "sex",
  "nationality",
  "kinship",
  "birthCountry",
  "birthPlace",
  "birthProvince",
  "docType",
  "docNumber",
  "docSupport",
  "docIssued",
  "docSpanish",
  "docCountry",
  "docPlace",
  "docProvince",
  "country",
  "street",
  "postalCode",
  "locality",
  "province",
  "phone",
  "email",
  "payment",
];
