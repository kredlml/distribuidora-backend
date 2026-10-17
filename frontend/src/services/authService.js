import { api } from "./api";

export const login = (email, password) => api("/api/auth/login", { method: "POST", body: { email, password } });
