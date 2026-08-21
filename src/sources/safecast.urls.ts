export const SAFECAST_PROVIDER = "safecast-radiation";
export const SAFECAST_DATASET = "measurements";

/** Latest public Safecast radiation measurements, newest first. */
export const SAFECAST_MEASUREMENTS_URL =
  "https://api.safecast.org/measurements.json?order=created_at+desc&per_page=100";
