// Amounts remain integer paise internally. Never use binary floating point for comparisons.
export function toPaise(value) {
  if (value === null || value === undefined || value === "") throw new Error("Amount is required.");
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error("Numeric amount is outside the exact supported range; supply a decimal string.");
  }
  let text = String(value).trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("Amount must be a decimal with at most two fractional digits.");
  const units = BigInt(match[2]);
  const fraction = BigInt((match[3] || "").padEnd(2, "0"));
  return (match[1] === "-" ? -1n : 1n) * (units * 100n + fraction);
}

export function fromPaise(value) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

export function normalizeAmount(value) {
  return fromPaise(toPaise(value));
}
