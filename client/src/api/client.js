import axios from "axios";
export { ERROR_CODES, CLIENT_ERROR_CODES, errorCode, errorMessage } from "./errors.js";

export const api = axios.create({ baseURL: "/api", withCredentials: true, timeout: 60000 });
export const salesApi = axios.create({ baseURL: "/api/sales", withCredentials: true, timeout: 60000 });

export const authApi = {
  me: () => api.get("/auth/me"),
  login: (values) => api.post("/auth/login", values),
  register: (values) => api.post("/auth/register", values),
  logout: () => api.post("/auth/logout"),
};

export const documentsApi = {
  list: () => salesApi.get("/documents"),
  get: (id) => salesApi.get(`/documents/${id}`),
  getOriginal: (id) => salesApi.get(`/document-org/${id}`),
  upload: (files, onUploadProgress) => {
    const form = new FormData();
    [...files].forEach((file) => form.append("files", file));
    return salesApi.post("/documents/upload", form, { onUploadProgress });
  },
  remove: (id) => salesApi.delete(`/documents/${id}`),
  removeMany: (documentIds) => salesApi.delete("/documents", { data: { documentIds } }),
  updateGstin: (documentIds, gstin) => salesApi.put("/documents/gstin", { documentIds, gstin }),
  updateMapping: (id, mapping) => salesApi.put(`/documents/${id}/mapping`, mapping),
  updateViewPreference: (id, mode) => salesApi.put(`/documents/${id}/view-preference`, { mode }),
};

export const reconciliationApi = {
  list: () => salesApi.get("/reconciliations"),
  run: (input) => salesApi.post("/reconciliations", input),
  remove: (id) => salesApi.delete(`/reconciliations/${id}`),
  exportData: (gstin, input) => {
    const params = typeof input === "string" ? { gstin, year: input } : { gstin, ...(input || {}) };
    return salesApi.get("/reconciliations/export-data", { params });
  },
  exportWorkbook: (gstin, input) => {
    const params = typeof input === "string" ? { gstin, year: input } : { gstin, ...(input || {}) };
    return salesApi.get("/reconciliations/export", { params, responseType: "blob" });
  },
  exportWorkbookWithRows: (gstin, input) => api.post("/reconciliations/export", { gstin, ...(input || {}) }, { responseType: "blob" }),
};
