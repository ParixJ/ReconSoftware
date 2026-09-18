export const TYPE_LABELS = {
  gstr1: "GSTR-1",
  gstr2: "GSTR-2",
  gstr2b: "GSTR-2B",
  gstr3b: "GSTR-3B",
  salesRegister: "Sales register",
  unknown: "Needs mapping",
};

export function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

export function period(value) {
  const formatSingle = (periodValue) => new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(Number(periodValue.slice(2)), Number(periodValue.slice(0, 2)) - 1, 1));
  const text = String(value || "");
  const range = text.match(/^((?:0[1-9]|1[0-2])\d{4})-((?:0[1-9]|1[0-2])\d{4})$/);
  if (range) return `${formatSingle(range[1])} - ${formatSingle(range[2])}`;
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(text)) return value || "Not detected";
  return formatSingle(text);
}

export function dateTime(value) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

