export const vehicleClasses = ["BS3", "BS4", "BS6"];
export const constructions = ["radial", "horse"];
export const defaultTyreSize = "295/90 R20";
// Common domestic and imported makes; Other keeps regional/new makes available.
export const manufacturers = [
  ["MRF", "mrftyres.com"],
  ["Apollo", "apollotyres.com"],
  ["CEAT", "ceat.com"],
  ["JK Tyre", "jktyre.com"],
  ["Bridgestone", "bridgestone.co.in"],
  ["Michelin", "michelin.in"],
  ["Goodyear", "goodyear.co.in"],
  ["Continental", "continental-tires.com"],
  ["Yokohama", "yokohama-india.com"],
  ["Pirelli", "pirelli.com"],
  ["Hankook", "hankooktire.com"],
  ["Dunlop", "dunloptyres.com"],
  ["Falken", "falkentyre.in"],
  ["Toyo", "toyotires.in"],
  ["Maxxis", "maxxistyres.in"],
  ["Kumho", "kumhotire.com"],
  ["Nexen", "nexentire.com"],
  ["BKT", "bkt-tires.com"],
  ["TVS Eurogrip", "eurogriptyres.com"],
  ["Birla", "birlatyre.com"],
  ["Ralco", "ralcotyres.com"],
  ["Ralson", "ralson.com"],
  ["Metro", "metrotyres.com"],
  ["Speedways", "speedwaystyres.com"],
  ["Malhotra / MRL", "mrltires.com"],
  ["Hartex", "hartextyres.com"],
  ["Reise", "reisemoto.com"],
  ["Kelly", "kellytires.com"],
  ["Firestone", "firestonetire.com"],
  ["Giti", "giti.com"],
  ["GT Radial", "gtradial.com"],
  ["Sailun", "sailuntire.com"],
  ["Triangle", "triangle.com.cn"],
  ["Linglong", "linglongtire.com"],
  ["Westlake", "westlaketyre.com"],
  ["Goodride", "goodridetire.com"],
  ["Double Coin", "doublecointires.com"],
  ["Chaoyang", "chaoyangtire.com"],
  ["Nokian", "nokiantyres.com"],
  ["Vredestein", "vredestein.co.in"],
  ["Kenda", "kendatire.com"],
  ["CST", "csttires.com"],
  ["Alliance", "yokohama-atg.com"],
  ["Mitas", "mitas-tires.com"],
  ["Camso", "camso.co"],
  ["Solideal", "camso.co"],
].map(([name, domain]) => ({ name, domain }));
export function manufacturerFor(brand) {
  const key = String(brand || "").toLowerCase();
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
