import { ERROR_CODES } from "../../api/errorCodes.js";
import fs from "node:fs/promises";
import { AppError } from "../../errors.js";

export async function detectFileType(filePath, originalName = "") {
  const handle = await fs.open(filePath, "r");
  const buffer = Buffer.alloc(4096);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  await handle.close();
  const head = buffer.subarray(0, bytesRead);
  const text = head.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  const extension = originalName.toLowerCase().split(".").pop();

  if (head.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) return "xlsx";
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  if (["csv", "txt"].includes(extension) || /[,;\t]/.test(text.split(/\r?\n/)[0] || "")) return "csv";
  throw new AppError(400, ERROR_CODES.UNSUPPORTED_FILE, `${originalName || "This file"} is not a supported PDF, XLSX, CSV, or JSON document.`);
}

