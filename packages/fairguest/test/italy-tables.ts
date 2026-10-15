/** Alloggiati Web tables with the format of the portal's files and invented codes and places. */
const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

export const TABLES_TEXT = {
  municipalities: [
    "Codice,Descrizione,Provincia,DataFineVal",
    "900000001,BORGO DI PROVA,ZZ,",
    "900000002,SANT'ESEMPIO,ZZ,",
    "900000003,DOPPIONE,ZZ,",
    "900000004,DOPPIONE,ZY,",
    "900000005,VECCHIO BORGO,ZZ,31/12/1990 00:00:00",
    "900000006,VECCHIO BORGO,ZZ,",
    ...many(1000, (i) => `${910000000 + i},RIEMPITIVO ${i},ZX,`),
  ].join("\r\n"),
  states: [
    "Codice,Descrizione,Provincia,DataFineVal",
    "100000100,ITALIA,ES,",
    "100000239,SPAGNA,ES,",
    "100000216,GERMANIA,ES,",
    "100000536,STATI UNITI D'AMERICA,ES,",
    "100000999,JUGOSLAVIA,ES,31/12/1992 00:00:00",
    ...many(100, (i) => `${190000000 + i},RIEMPITIVO ${i},ES,`),
  ].join("\r\n"),
  documents: ["Codice,Descrizione", "IDENT,CARTA DI IDENTITA'", "IDELE,CARTA IDENTITA' ELETTRONICA", "PASOR,PASSAPORTO ORDINARIO", "PATEN,PATENTE DI GUIDA"].join("\r\n"),
};
