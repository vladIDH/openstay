# fairguest

Guest registration for short-term rentals, on the host's computer. *0.1.0, in development.*

In Spain (Real Decreto 933/2021) and in Italy (art. 109 TULPS, Alloggiati Web) every host must send the police the details of each guest. Fairguest is the part of [OpenStay](https://github.com/vladIDH/openstay) that handles this. Hosts use it through the `fairnight ospiti` commands and the check-in form of [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli). This package is the library underneath it: no network, no files, no dependencies, only Node's own `crypto`.

## What it does

- **One interface for every country** (`Registry`): `validate`, `deadlines`, `prepare`, `send`, `status`, `cancel` and `retention`, all over neutral `Guest` and `Stay` shapes. The network is never inside: `send` and `status` receive a transport from the caller.
- **The rules of Real Decreto 933/2021**, with every problem reported at once and the path of its field:
  - name, first surname, date of birth, address and a contact for each guest;
  - the identity document, needed from 18 years old for SES and from 14 for the Mossos;
  - the support number of a DNI or NIE card, and the second surname with a DNI;
  - the INE code of the municipality when the address is in Spain: the form finds it from the town's name in the INE's official list (`findEsMunicipality`); 6 digits are kept, as the Mossos file wants, and SES takes the first 5 (`sesMunicipalityCode`);
  - the relationship to the holder for minors;
  - the **type** of payment, and nothing more about it.
- **Deadlines** (art. 6.3): within 24 hours of the booking (RH) and within 24 hours of check-in (PV). When the hour is not known, the count starts at midnight, so the deadline shown is never later than the real one.
- **Retention** (art. 5.3 and 5.4):
  - **professional hosts** keep the register 3 years from check-out;
  - **non-professional hosts**, the default, keep nothing once the check-in communication is confirmed, and keep data 48 hours after a cancellation.
- **Encryption at rest:**
  - each value is sealed for an X25519 public key: a fresh key pair per value, then HKDF-SHA256 and AES-256-GCM. The place where the value is stored is bound in as additional data, so a value cannot be moved to another row;
  - the private key is locked with a key derived from the host's passphrase with scrypt (N = 2¹⁷);
  - writing needs only the public key, so the check-in form can store a guest without knowing any secret. Reading needs the passphrase;
  - changing the passphrase re-encrypts only the private key.
- **Catalonia, Mossos d'Esquadra** (`ES-CT`): the text file uploaded by hand on registreviatgers.mossos.gencat.cat. It is built from the public manual, version 8 of May 2025, chapter 4 and the example in chapter 9:
  - a record 1 for the establishment with format `V24`;
  - one record 2 per traveller, with 32 fields separated by `|`;
  - capitals, CR LF between records, ISO-8859-1;
  - file name `<ID>.001`…`.999`.

  One file holds one establishment.
- **Spain, SES.HOSPEDAJES** (`ES`): validation, deadlines and retention are ready. **The XML is not written yet.** Its XSD schemas are published only inside the SES application, so until they are downloaded, `prepare` fails with `SES_NOT_READY`, a message that says what is missing. Nothing invented is ever sent.

- **Italy, Alloggiati Web** (`IT`), from the official web-service manual (Rev. 01 of 24/01/2022) and the user manual of the Polizia di Stato's portal:
  - every guest: name, surname, sex, date and place of birth, citizenship; the identity document only for the holder (single guest 16, head of family 17 or of group 18; family members 19 and group members 20 have none);
  - `schedine` turns a stay into lines of 168 characters with the codes of the official tables (municipalities, states, documents). The tables are not in this package: the caller downloads them from the portal's public page and passes them in (`parseAlloggiatiTables`);
  - `AlloggiatiClient`: the SOAP 1.2 calls `GenerateToken`, `Authentication_Test`, `Test`, `Send` (and their "Gestione Appartamenti" variants), `Ricevuta`, `Tabella`, through a transport given by the caller. There is no test environment: `Test` checks without registering, on the real service;
  - deadlines: 24 hours from arrival, 6 for a stay of 24 hours or less; no booking communication;
  - retention: the data goes as soon as Alloggiati Web accepted it; only the receipt is kept, 5 years.

**Never collected:** card numbers, IBANs, card holders. They have no place in the types, and `parseGuest` ignores any field it does not know.

## Example

```ts
import { createKeys, mossosFile, open, parseGuest, publicKeyOf, registryFor, seal, unlock } from "fairguest";

const keys = createKeys("a long passphrase only the host knows");
const { guest, problems } = parseGuest({ givenName: "Ospite", surname1: "Prova", birthDate: "2060-03-15" }, "2099-06-01");

const sealed = seal(publicKeyOf(keys), guest, "guest_people/gp1/data");     // no passphrase needed
const again = open(unlock(keys, "a long passphrase only the host knows"), sealed, "guest_people/gp1/data");

const mossos = registryFor("ES-CT");
mossos.validate(stay, "checkin");                                            // [] when complete
mossos.deadlines({ checkIn: "2099-06-10", checkInTime: "16:00", bookedAt: "2099-05-20", seenAt: "2099-05-20T10:00" });
mossosFile([stay], "checkin", "2099-06-10T18:05", 1);                         // { name: "ZZ00000000.001", text, bytes }
```

If the passphrase is lost, the data cannot be opened again by anyone.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
