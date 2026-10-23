export function isDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T12:00:00Z");
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function parseDisplayDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || "").trim());
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  return isDay(iso) ? iso : "";
}
export function displayDate(value, time = false) {
  if (!value) return "—";
  if (isDay(value)) return value.split("-").reverse().join("/");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(time ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year}${time ? ` ${parts.hour}:${parts.minute}` : ""}`;
}
export function addCalendarMonths(day, months) {
  if (!isDay(day)) return "";
  const [year, month, date] = day.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(date, last)).padStart(2, "0")}`;
}
