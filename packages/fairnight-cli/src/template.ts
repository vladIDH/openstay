/**
 * What `fairnight init` writes. All names, prices and links are invented;
 * the links use example.com on purpose and must be replaced by the host.
 */
import type { HostConfig } from "./config.js";

export const EXAMPLE_CONFIG: HostConfig = {
  // AirROI is optional: it needs the host's own key and a zone under market.airroi.areas.
  market: { airroi: { enabled: true } },
  listings: [
    {
      name: "seaview-loft",
      calendars: [
        { source: "airbnb", url: "https://calendar.example.com/airbnb/seaview-loft.ics" },
        { source: "booking", url: "https://calendar.example.com/booking/seaview-loft.ics" },
      ],
      pricing: {
        listingId: "seaview-loft",
        name: "Seaview Loft",
        currency: "EUR",
        basePrice: 100,
        defaultMinStay: 3,
        factors: {
          limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 },
          seasons: {
            enabled: true,
            periods: [
              { name: "Year-end holidays", start: "12-20", end: "01-06", multiplier: 1.35 },
              { name: "Winter sun", start: "01-07", end: "03-31", multiplier: 1.15 },
              { name: "Summer", start: "07-01", end: "08-31", multiplier: 1.25 },
            ],
          },
          dayOfWeek: { enabled: true, adjustments: { fri: 10, sat: 15, sun: -5 } },
          lastMinute: {
            enabled: true,
            steps: [
              { withinDays: 3, discountPercent: 15, minStay: 1 },
              { withinDays: 7, discountPercent: 8, minStay: 2 },
            ],
          },
          farOut: { enabled: true, steps: [{ fromDays: 180, premiumPercent: 8, minStay: 4 }] },
          gaps: { enabled: true, maxNights: 2, discountPercent: 12, lowerMinStay: true },
          occupancy: {
            enabled: true,
            highThresholdPercent: 75,
            raisePercent: 8,
            lowThresholdPercent: 25,
            lowerPercent: 6,
            withinDays: 60,
          },
          events: {
            enabled: true,
            list: [{ date: "2026-12-31", name: "New Year's Eve", impact: 5 }],
          },
          // Zone demand: off. To use it, import zone data ("fairnight mercato importa"),
          // add "marketArea" to the listing and set enabled to true.
          market: { enabled: false, weight: 0.5, maxRaisePercent: 15, maxLowerPercent: 10 },
          rounding: { enabled: true, step: 1 },
          overrides: { enabled: true, dates: [] },
        },
      },
    },
    {
      name: "garden-studio",
      calendars: [{ source: "vrbo", url: "https://calendar.example.com/vrbo/garden-studio.ics" }],
      pricing: {
        listingId: "garden-studio",
        name: "Garden Studio",
        currency: "EUR",
        basePrice: 70,
        defaultMinStay: 2,
        factors: {
          limits: { enabled: true, floorPrice: 45, ceilingPrice: 160 },
          dayOfWeek: { enabled: true, adjustments: { fri: 8, sat: 12 } },
          lastMinute: { enabled: true, steps: [{ withinDays: 5, discountPercent: 10, minStay: 1 }] },
          gaps: { enabled: true, maxNights: 2, discountPercent: 10, lowerMinStay: true },
          rounding: { enabled: true, step: 1 },
        },
      },
    },
  ],
};

export const LOCAL_README = [
  "Fairnight folder: fairnight.config.json holds your listings, price rules and iCal links (replace the example ones).",
  "Run \"fairnight sync\" to read the calendars, \"fairnight price\" to see the price of every night, \"fairnight import <file.csv> --listing <name>\" for past prices.",
  "Everything stays in this folder: the database is data/fairnight.db, and the only internet access is to the iCal links you write.",
].join("\n") + "\n";

/** The guide left in the host's folder by `fairnight configura` (the installer), in Italian or Spanish. */
export const HOST_README: Record<"it" | "es", { file: string; text: string }> = {
  it: {
    file: "LEGGIMI.txt",
    text: [
      "Fairnight: i prezzi delle tue notti, calcolati sul tuo computer.",
      "",
      "COSA C'È IN QUESTA CARTELLA",
      "- Fairnight: apre il calendario dei prezzi. È lo stesso dell'icona Fairnight sul desktop (sul Mac, sulla Scrivania).",
      "- Cambia impostazioni: cambia le case, i link dei calendari e i prezzi.",
      "- fairnight.config.json: le tue impostazioni. Meglio cambiarle con «Cambia impostazioni».",
      "- data: i calendari letti e i prezzi. Non serve aprirla.",
      "- programma: Fairnight stesso. Non serve aprirla.",
      "- installazione.log: il resoconto dell'ultima installazione.",
      "",
      "USARE FAIRNIGHT",
      "Doppio clic su Fairnight: si apre una finestra e poi il calendario nel browser.",
      "La finestra deve restare aperta mentre usi il calendario: puoi ridurla a icona. Chiudendola, Fairnight si spegne.",
      "",
      "AGGIORNARE",
      "Scarica di nuovo lo zip e fai doppio clic su «Installa Fairnight (Windows)» o «Installa Fairnight (Mac)».",
      "Le impostazioni e i dati restano come sono.",
      "",
      "UNA COPIA DI SICUREZZA",
      "Copia fairnight.config.json e la cartella data su una chiavetta o in un'altra cartella.",
      "",
      "I TUOI DATI",
      "Restano solo su questo computer. Fairnight si collega a internet solo per quello che hai scelto tu:",
      "i link dei calendari e, se li colleghi, Smoobu o Beds24.",
      "",
      "SE QUALCOSA NON VA",
      "Scrivici a hello@khlumen.com e allega il file installazione.log.",
      "Guida completa, con le schermate: https://github.com/vladIDH/openstay/blob/main/docs/installa.md",
    ].join("\n") + "\n",
  },
  es: {
    file: "LEEME.txt",
    text: [
      "Fairnight: los precios de tus noches, calculados en tu ordenador.",
      "",
      "QUÉ HAY EN ESTA CARPETA",
      "- Fairnight: abre el calendario de precios. Es lo mismo que el icono Fairnight del escritorio.",
      "- Cambia impostazioni: cambia las casas, los enlaces de los calendarios y los precios.",
      "- fairnight.config.json: tu configuración. Mejor cambiarla con «Cambia impostazioni».",
      "- data: los calendarios leídos y los precios. No hace falta abrirla.",
      "- programma: Fairnight en sí. No hace falta abrirla.",
      "- installazione.log: el informe de la última instalación.",
      "",
      "USAR FAIRNIGHT",
      "Doble clic en Fairnight: se abre una ventana y luego el calendario en el navegador.",
      "La ventana tiene que quedar abierta mientras usas el calendario: puedes minimizarla. Al cerrarla, Fairnight se apaga.",
      "",
      "ACTUALIZAR",
      "Descarga otra vez el zip y haz doble clic en «Installa Fairnight (Windows)» o «Installa Fairnight (Mac)».",
      "La configuración y los datos se quedan como están.",
      "",
      "UNA COPIA DE SEGURIDAD",
      "Copia fairnight.config.json y la carpeta data en un pendrive o en otra carpeta.",
      "",
      "TUS DATOS",
      "Se quedan solo en este ordenador. Fairnight se conecta a internet solo para lo que has elegido tú:",
      "los enlaces de los calendarios y, si los conectas, Smoobu o Beds24.",
      "",
      "SI ALGO NO FUNCIONA",
      "Escríbenos a hello@khlumen.com y adjunta el archivo installazione.log.",
      "Guía completa con capturas (en italiano): https://github.com/vladIDH/openstay/blob/main/docs/installa.md",
    ].join("\n") + "\n",
  },
};
