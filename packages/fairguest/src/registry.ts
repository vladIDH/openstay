import { mossosRegistry } from "./countries/es-mossos.js";
import { sesRegistry } from "./countries/es-ses.js";
import { alloggiatiRegistry } from "./countries/it-alloggiati.js";
import type { Country, Registry } from "./types.js";

const REGISTRIES: Record<Country, Registry> = { ES: sesRegistry, "ES-CT": mossosRegistry, IT: alloggiatiRegistry };

/** The registry of a country. */
export function registryFor(country: Country): Registry {
  return REGISTRIES[country];
}
