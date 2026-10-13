/** Invented data only: nobody real is called Ospite Prova or holds document ZZ0000000. */
import type { Guest, Stay } from "../src/types.js";

export const TODAY = "2099-06-01";

export const holder = (): Guest => ({
  givenName: "Ospite",
  surname1: "Prova",
  surname2: "Esempio",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  document: { type: "passport", number: "ZZ0000000", issuedOn: "2095-01-10" },
  address: { country: "ITA", street: "Via di Prova 1", locality: "Città di Prova", postalCode: "00000" },
  email: "ospite.prova@example.com",
});

export const child = (): Guest => ({
  givenName: "Esempio",
  surname1: "Prova",
  birthDate: "2092-07-01",
  nationality: "ITA",
  address: { country: "ITA", street: "Via di Prova 1", locality: "Città di Prova", postalCode: "00000" },
  phone: "+39 000 000 0000",
  kinship: "child",
});

export const stay = (over: Partial<Stay> = {}): Stay => ({
  id: "stay-prova-1",
  establishment: "ZZ00000000",
  establishmentName: "Casa di Prova",
  reference: "PROVA-0001",
  contractDate: "2099-05-20",
  checkIn: "2099-06-10",
  checkInTime: "16:00",
  checkOut: "2099-06-13",
  checkOutTime: "10:00",
  people: 2,
  rooms: 1,
  internet: true,
  payment: { type: "platform" },
  guests: [holder(), child()],
  ...over,
});
