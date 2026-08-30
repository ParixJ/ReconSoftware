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
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(value || "")) return value || "Not detected";
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(Number(value.slice(2)), Number(value.slice(0, 2)) - 1, 1));
}

export function dateTime(value) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

