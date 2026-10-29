// Older records retain their three original readings. Display their arithmetic
// average without rewriting history; new readings store averagePercent directly.
export function averageNsd(reading) {
  if (!reading) return null;
  if (Number.isFinite(reading.averagePercent)) return reading.averagePercent;
  const values = ["inner", "center", "outer"]
    .map((k) => reading[k])
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  return values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) /
        100
    : null;
}
