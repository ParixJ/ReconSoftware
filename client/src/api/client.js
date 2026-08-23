import axios from "axios";

export const api = axios.create({ baseURL: "/api", withCredentials: true, timeout: 60000 });

export function errorMessage(error, fallback = "The request could not be completed.") {
  return error?.response?.data?.error?.message || error?.message || fallback;
}

export const authApi = {
  me: () => api.get("/auth/me"),
  login: (values) => api.post("/auth/login", values),
  register: (values) => api.post("/auth/register", values),
  logout: () => api.post("/auth/logout"),
};

export const documentsApi = {
  list: () => api.get("/documents"),
  get: (id) => api.get(`/documents/${id}`),
  upload: (files, onUploadProgress) => {
    const form = new FormData();
    [...files].forEach((file) => form.append("files", file));
    return api.post("/documents/upload", form, { onUploadProgress });
  },
  updateMapping: (id, mapping) => api.put(`/documents/${id}/mapping`, mapping),
  updateViewPreference: (id, mode) => api.put(`/documents/${id}/view-preference`, { mode }),
};

export const reconciliationApi = {
  list: () => api.get("/reconciliations"),
  run: (input) => api.post("/reconciliations", input),
};
