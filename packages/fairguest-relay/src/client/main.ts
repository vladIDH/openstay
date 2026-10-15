/**
 * The guest's page of the check-in link. Everything happens in this browser:
 * - the stay, the host's public key and the write secret come from the part of
 *   the link after "#", which the browser never sends to the server;
 * - the form is the «Carta» form of the host's own network, drawn by the same
 *   code, with the same rules;
 * - each guest is sealed here for the host's public key and only then posted;
 * - the photo of the document is read here (MRZ) and never leaves the phone.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import {
  errorsByField,
  esc,
  FORM_KEYS,
  guestFromMrz,
  guestInput,
  isPaymentType,
  LANGS,
  localDateTime,
  LOCK,
  padded,
  parseGuest,
  pickLang,
  readLinkFragment,
  registryFor,
  relayPlace,
  renderForm,
  stayDay,
  stepsBar,
  TICK,
  webSeal,
  WORDS,
  type Guest,
  type Lang,
  type LinkPayload,
  type Problem,
  type Words,
  type X25519Fallback,
} from "fairguest/browser";

const app = document.getElementById("app") as HTMLElement;
const box = /^\/c\/([A-Za-z0-9_-]{22})$/.exec(location.pathname)?.[1] ?? "";
const link: LinkPayload | null = box ? readLinkFragment(location.hash) : null;
const query = new URLSearchParams(location.search);
let lang: Lang = pickLang(query.get("lang"), navigator.languages.join(","));
const storeKey = `fairguest:${box}`;

/** Guests saved from this phone: the first one is the holder. Kept only for this visit. */
function savedCount(): number {
  try {
    return Number(sessionStorage.getItem(storeKey) ?? "0") || 0;
  } catch {
    return 0;
  }
}
function setSavedCount(n: number): void {
  try {
    sessionStorage.setItem(storeKey, String(n));
  } catch {
    /* a private window: the count lasts as long as the page */
  }
}
let saved = savedCount();

const fallback: X25519Fallback = {
  keyPair() {
    const k = x25519.keygen();
    return { privateKey: k.secretKey, publicKey: k.publicKey };
  },
  shared: (privateKey, publicKey) => x25519.getSharedSecret(privateKey, publicKey),
};

const today = () => localDateTime(new Date()).slice(0, 10);
const law = (w: Words) => (link?.c === "IT" ? w.italy : w);

function header(w: Words, step: 1 | 2 | 3): string {
  if (!link) return "";
  const nav = `<nav>${LANGS.map((l) => `<a href="?lang=${l}${esc(location.hash)}" hreflang="${l}"${l === lang ? ' aria-current="true"' : ""}>${WORDS[l].langName}</a>`).join("")}</nav>`;
  return (
    `<header class="top"><h1>${esc(w.title)}</h1>${nav}</header>` +
    `<div class="stay"><b>${esc(link.n)}</b><span>${esc(w.stay)}: ${esc(stayDay(link.i, lang))} → ${esc(stayDay(link.o, lang))}</span></div>` +
    stepsBar(w, step) +
    `<p class="privacy-line">${LOCK}<span>${esc(law(w).privacyShort)} ${esc(w.remote.encrypted)}</span></p>`
  );
}

function photoBlock(w: Words, note: string | null): string {
  return `<section class="photo"><h2>${esc(w.remote.photoTitle)}</h2><p class="hint">${esc(w.remote.photoHint)}</p>
<label class="button secondary" for="photo">${esc(w.remote.photoButton)}</label><input id="photo" type="file" accept="image/*" capture="environment" class="visually-hidden">
<p class="photo-note" role="status">${note ? esc(note) : ""}</p></section>`;
}

interface FormView {
  values: Record<string, string>;
  errors: Map<string, string>;
  banner?: string;
  photoNote?: string | null;
}

function showForm(view: FormView = { values: {}, errors: new Map() }): void {
  if (!link) return showMessage("notFound");
  const w = WORDS[lang];
  document.documentElement.lang = lang;
  document.title = w.title;
  const form = renderForm(w, lang, link.c, "#", "", saved, { values: view.values, errors: view.errors });
  app.innerHTML =
    header(w, 1) +
    (view.banner ? `<div class="banner bad" role="alert">${esc(view.banner)}</div>` : `<p class="intro">${esc(law(w).intro)}</p>`) +
    photoBlock(w, view.photoNote ?? null) +
    form +
    `<p class="privacy">${esc(law(w).privacy)}</p>`;
  wire();
}

function showDone(): void {
  if (!link) return;
  const w = WORDS[lang];
  app.innerHTML =
    header(w, 3) +
    `<div class="done-card" role="status"><div class="tick">${TICK}</div><h2>${esc(w.saved(saved))}</h2><p>${esc(w.finished)}</p></div>` +
    `<button type="button" class="button secondary" id="another">${esc(w.addAnother)}</button>` +
    `<p class="privacy">${esc(law(w).privacy)}</p>`;
  document.getElementById("another")?.addEventListener("click", () => showForm());
}

function showMessage(kind: "notFound" | "expired" | "oldBrowser"): void {
  const w = WORDS[lang];
  const text = kind === "notFound" ? w.notFoundText : kind === "expired" ? w.remote.expired : w.remote.oldBrowser;
  app.innerHTML = `<header class="top"><h1>${esc(kind === "notFound" ? w.notFound : w.title)}</h1></header><p class="message">${esc(text)}</p>`;
}

/** What the form had, so nothing typed is lost. */
function currentValues(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const values: Record<string, string> = {};
  for (const k of FORM_KEYS) values[k] = String(data.get(k) ?? "");
  return values;
}

/** The form's fields from what the MRZ said; the guest checks them. */
function valuesFromMrz(g: Partial<Guest>, before: Record<string, string>): Record<string, string> {
  const v = { ...before };
  if (g.givenName) v.givenName = g.givenName;
  if (g.surname1) v.surname1 = g.surname1;
  if (g.surname2) v.surname2 = g.surname2;
  if (g.birthDate) v.birthDate = g.birthDate;
  if (g.sex && g.sex !== "other") v.sex = g.sex;
  if (g.nationality) v.nationality = g.nationality;
  if (g.document) {
    const offered = registryFor(link?.c ?? "ES").documentTypes;
    if (offered.includes(g.document.type)) v.docType = g.document.type;
    else if (g.document.type === "electronic_id" || g.document.type === "dni") v.docType = offered.includes("id_card") ? "id_card" : "other";
    if (g.document.number) v.docNumber = g.document.number;
    if (g.document.support) v.docSupport = g.document.support;
    if (g.document.issuedIn?.country) v.docCountry = g.document.issuedIn.country;
    if (g.document.spanish) v.docSpanish = "1";
  }
  return v;
}

function wire(): void {
  const form = document.getElementById("form") as HTMLFormElement | null;
  const photo = document.getElementById("photo") as HTMLInputElement | null;
  const note = app.querySelector(".photo-note");
  photo?.addEventListener("change", async () => {
    const file = photo.files?.[0];
    if (!file || !form) return;
    const w = WORDS[lang];
    const before = currentValues(form);
    if (note) note.textContent = w.remote.reading;
    try {
      const { readDocument } = await import("./ocr.js");
      const m = await readDocument(file, today());
      if (!m) return showForm({ values: before, errors: new Map(), photoNote: w.remote.readFail });
      showForm({ values: valuesFromMrz(guestFromMrz(m), before), errors: new Map(), photoNote: m.valid ? w.remote.readOk : w.remote.readPartial });
    } catch {
      showForm({ values: before, errors: new Map(), photoNote: w.remote.readFail });
    } finally {
      // The photo is not kept: the input forgets the file.
      photo.value = "";
    }
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit(form);
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  if (!link) return;
  const w = WORDS[lang];
  const values = currentValues(form);
  const fields = new URLSearchParams(values);
  const parsed = parseGuest(guestInput(fields), today());
  const problems: Problem[] = [...parsed.problems, ...registryFor(link.c).checkGuest(parsed.draft, saved, link.i)];
  const payment = values.payment ?? "";
  if (link.c !== "IT" && saved === 0 && !isPaymentType(payment)) problems.push({ path: "payment", message: "the type of payment is required" });
  if (problems.length > 0 || !parsed.guest) return showForm({ values, errors: errorsByField(problems, w), banner: w.fix });
  const button = form.querySelector("button[type=submit]") as HTMLButtonElement | null;
  if (button) {
    button.disabled = true;
    button.textContent = w.remote.sending;
  }
  try {
    const message = { guest: parsed.guest, ...(saved === 0 && isPaymentType(payment) ? { payment } : {}) };
    const sealed = await webSeal(link.k, padded(message), relayPlace(box), { fallback });
    const res = await fetch(`/api/box/${box}/messages`, { method: "POST", headers: { "content-type": "text/plain", "x-fairguest-write": link.w }, body: sealed });
    if (res.status === 404) return showMessage("expired");
    if (!res.ok) throw new Error(String(res.status));
    saved++;
    setSavedCount(saved);
    showDone();
  } catch (e) {
    if (e instanceof Error && /X25519|not supported/i.test(e.message)) return showMessage("oldBrowser");
    showForm({ values, errors: new Map(), banner: w.remote.sendFail });
  }
}

if (!globalThis.crypto?.subtle) showMessage("oldBrowser");
else if (!link) showMessage("notFound");
else showForm();
// Changing language keeps everything after "#": the links carry it.
window.addEventListener("popstate", () => {
  lang = pickLang(new URLSearchParams(location.search).get("lang"), navigator.languages.join(","));
});
