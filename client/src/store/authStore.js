import { create } from "zustand";
import { authApi } from "../api/client.js";

export const useAuthStore = create((set) => ({
  user: null,
  status: "checking",
  initialize: async () => {
    try {
      const { data } = await authApi.me();
      set({ user: data.user, status: "authenticated" });
    } catch {
      set({ user: null, status: "anonymous" });
    }
  },
  setUser: (user) => set({ user, status: user ? "authenticated" : "anonymous" }),
  logout: async () => {
    try { await authApi.logout(); } finally { set({ user: null, status: "anonymous" }); }
  },
}));

