import { describe, expect, it } from "vitest";
import { InsideAirbnbCalendar, InsideAirbnbError, InsideAirbnbListings, insideAirbnbMarket } from "../src/index.js";

/** Invented listings in the Inside Airbnb layout (a description with a line break, as in the real files). */
const LISTINGS = [
  "id,name,description,neighbourhood_cleansed,room_type,accommodates,bedrooms,price",
  '101,Invented flat,"Sunny,\nnear the sea",Playa Ficticia,Entire home/apt,4,2,$120.00',
  "102,Invented room,Quiet,Playa Ficticia,Private room,2,1,$50.00",
  "103,Invented villa,Big,Monte Ficticio,Entire home/apt,8,4,$300.00",
  "104,Invented loft,Nice,Playa Ficticia,Entire home/apt,4,2,$110.00",
  "105,Invented closed flat,Never open,Playa Ficticia,Entire home/apt,4,2,$100.00",
].join("\n");

/** Two nights per listing; 105 is closed on both (it looks inactive). */
const CALENDAR = [
  "listing_id,date,available,price,adjusted_price,minimum_nights,maximum_nights",
  '101,2026-11-01,f,"$1,120.00",,2,30',
  "101,2026-11-02,t,$120.00,,2,30",
  "102,2026-11-01,t,$50.00,,1,30",
  "102,2026-11-02,t,$50.00,,1,30",
  "103,2026-11-01,f,$300.00,,3,30",
  "103,2026-11-02,t,$300.00,,3,30",
  "104,2026-11-01,f,$100.00,,2,30",
  "104,2026-11-02,t,,,2,30",
  "105,2026-11-01,f,$100.00,,2,30",
  "105,2026-11-02,f,$100.00,,2,30",
  "106,not-a-date,t,$1.00,,1,1",
].join("\n");

/** Feed the text in small pieces, like a file stream. */
function feedInChunks(reader: { feed(c: string): void }, text: string, size = 7): void {
  for (let i = 0; i < text.length; i += size) reader.feed(text.slice(i, i + size));
}

describe("Inside Airbnb import", () => {
  it("estimates the zone occupancy from not-available nights, leaving out listings always closed", () => {
    const cal = new InsideAirbnbCalendar();
    feedInChunks(cal, CALENDAR);
    const s = cal.end();
    expect(s.listings).toBe(4);
    expect(s.alwaysClosed).toBe(1);
    expect(s.badLines).toBe(1);
    expect(s.days).toEqual([
      { date: "2026-11-01", occupancyPercent: 75, comparables: 4, averagePrice: 392.5 },
      { date: "2026-11-02", occupancyPercent: 0, comparables: 4, averagePrice: 156.67 },
    ]);
  });

  it("keeps only comparable listings when the listings file is given", () => {
    const listings = new InsideAirbnbListings({ roomType: "entire home/apt", bedrooms: 2, neighbourhood: "playa ficticia" });
    feedInChunks(listings, LISTINGS);
    const ids = listings.end();
    expect([...ids]).toEqual(["101", "104", "105"]);
    expect(listings.seen).toBe(5);
    const cal = new InsideAirbnbCalendar(ids);
    cal.feed(CALENDAR);
    expect(cal.end().days).toEqual([
      { date: "2026-11-01", occupancyPercent: 100, comparables: 2, averagePrice: 610 },
      { date: "2026-11-02", occupancyPercent: 0, comparables: 2, averagePrice: 120 },
    ]);
  });

  it("names the source with its licence and marks the occupancy as estimated", () => {
    const cal = new InsideAirbnbCalendar();
    cal.feed(CALENDAR);
    const market = insideAirbnbMarket(cal.end(), "playa-ficticia", "2026-11-01");
    expect(market).toMatchObject({
      source: "insideairbnb",
      attribution: "Inside Airbnb (insideairbnb.com), CC BY 4.0",
      estimated: true,
      area: "playa-ficticia",
    });
  });

  it("refuses files that are not Inside Airbnb files", () => {
    const cal = new InsideAirbnbCalendar();
    expect(() => cal.feed("date,occupancy\n2026-11-01,50\n")).toThrow(InsideAirbnbError);
    expect(() => new InsideAirbnbCalendar().end()).toThrow("The calendar file is empty.");
  });
});
