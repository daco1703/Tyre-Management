import readExcelFile from "read-excel-file/browser";
import writeExcelFile from "write-excel-file/browser";
import { VEHICLE_HEADERS } from "../shared/vehicle-import.js";

export async function readVehicleWorkbook(file) {
  if (!/\.xlsx$/i.test(file.name)) throw { code: "importFileType" };
  if (file.size > 2 * 1024 * 1024) throw { code: "importFileSize" };
  try {
    return await readExcelFile(file);
  } catch {
    throw { code: "importUnreadable" };
  }
}
export function makeVehicleTemplate() {
  return writeExcelFile(
    [
      VEHICLE_HEADERS.map((value) => ({
        value,
        type: String,
        fontWeight: "bold",
        backgroundColor: "#173f35",
        color: "#ffffff",
      })),
    ],
    {
      sheet: "Vehicles",
      columns: [{ width: 28 }, { width: 32 }, { width: 22 }, { width: 18 }],
    },
  ).toBlob();
}
