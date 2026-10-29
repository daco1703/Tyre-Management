export const vehicleClasses = ["BS3", "BS4", "BS6"];
export const constructions = ["radial", "horse"];
export const defaultTyreSize = "295/90 R20";
// Dropdown choices only. Other manufacturer names remain valid as custom entries.
export const manufacturers = [
  ["MRF", "mrf"],
  ["Apollo", "apollo", "jpg"],
  ["CEAT", "ceat"],
  ["JK Tyre", "jk-tyre"],
  ["Bridgestone", "bridgestone", "webp"],
  ["Michelin", "michelin", "jpg"],
  ["Goodyear", "goodyear", "jpg"],
].map(([name, slug, extension = "png"]) => ({
  name,
  logo: `/brands/${slug}.${extension}`,
}));
export function manufacturerFor(brand) {
  const key = String(brand || "")
    .trim()
    .toLowerCase();
  return (
    manufacturers.find((m) => key === m.name.toLowerCase()) ||
    manufacturers.find((m) => key.startsWith(m.name.toLowerCase() + " "))
  );
}
export const inspectionIssues = [
  "misalignment",
  "unevenWear",
  "lowPressure",
  "highPressure",
  "lowTread",
  "cuts",
  "cracks",
  "bulge",
  "puncture",
  "valveDamage",
  "looseNuts",
  "missingTyre",
  "other",
];
