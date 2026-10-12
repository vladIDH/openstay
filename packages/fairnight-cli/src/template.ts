/**
 * What `fairnight init` writes. All names, prices and links are invented;
 * the links use example.com on purpose and must be replaced by the host.
 */
import type { HostConfig } from "./config.js";

export const EXAMPLE_CONFIG: HostConfig = {
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
