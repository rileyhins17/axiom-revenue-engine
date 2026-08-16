export type ScrapeGeography = {
  city: string;
  country?: string | null;
  region?: string | null;
};

const COUNTRY_LABELS: Record<string, string> = {
  CA: "Canada",
  US: "United States",
};

function cleanGeographyPart(value: string | null | undefined) {
  return String(value || "").trim();
}

export function normalizeCountryCode(value: string | null | undefined) {
  const code = cleanGeographyPart(value).toUpperCase();
  return code || "CA";
}

export function countryLabel(value: string | null | undefined) {
  const country = normalizeCountryCode(value);
  return COUNTRY_LABELS[country] || cleanGeographyPart(value) || country;
}

/**
 * Builds a location-explicit Maps query. The old engine appended Ontario to
 * every city, including US and non-Ontario targets, which made target metadata
 * disagree with the businesses actually collected.
 */
export function buildMapsSearchQuery(input: ScrapeGeography & { niche: string }) {
  const niche = cleanGeographyPart(input.niche);
  const city = cleanGeographyPart(input.city);
  const region = cleanGeographyPart(input.region);
  const country = countryLabel(input.country);
  const location = [city, region, country].filter(Boolean).join(", ");

  return `${niche} in ${location}`;
}

export function browserLocaleForCountry(value: string | null | undefined) {
  return normalizeCountryCode(value) === "US" ? "en-US" : "en-CA";
}
