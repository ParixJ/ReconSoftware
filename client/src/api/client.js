import axios from "axios";
export { ERROR_CODES, CLIENT_ERROR_CODES, errorCode, errorMessage } from "./errors.js";

export const api = axios.create({ baseURL: "/api", withCredentials: true, timeout: 60000 });

export const authApi = {
  me: () => api.get("/auth/me"),
  login: (values) => api.post("/auth/login", values),
  register: (values) => api.post("/auth/register", values),
  logout: () => api.post("/auth/logout"),
};

export const documentsApi = {
  list: () => api.get("/documents"),
  get: (id) => api.get(`/documents/${id}`),
  getOriginal: (id) => api.get(`/document-org/${id}`),
  upload: (files, onUploadProgress) => {
    const form = new FormData();
    [...files].forEach((file) => form.append("files", file));
    return api.post("/documents/upload", form, { onUploadProgress });
  },
  remove: (id) => api.delete(`/documents/${id}`),
  removeMany: (documentIds) => api.delete("/documents", { data: { documentIds } }),
  updateGstin: (documentIds, gstin) => api.put("/documents/gstin", { documentIds, gstin }),
  updateMapping: (id, mapping) => api.put(`/documents/${id}/mapping`, mapping),
  updateViewPreference: (id, mode) => api.put(`/documents/${id}/view-preference`, { mode }),
};

export const reconciliationApi = {
  list: () => api.get("/reconciliations"),
  run: (input) => api.post("/reconciliations", input),
  remove: (id) => api.delete(`/reconciliations/${id}`),
  exportData: (gstin, input) => {
    const params = typeof input === "string" ? { gstin, year: input } : { gstin, ...(input || {}) };
    return api.get("/reconciliations/export-data", { params });
  },
  exportWorkbook: (gstin, input) => {
    const params = typeof input === "string" ? { gstin, year: input } : { gstin, ...(input || {}) };
    return api.get("/reconciliations/export", { params, responseType: "blob" });
  },
  exportWorkbookWithRows: (gstin, input) => api.post("/reconciliations/export", { gstin, ...(input || {}) }, { responseType: "blob" }),
};
