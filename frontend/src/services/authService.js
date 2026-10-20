import { api } from "./api";

export const login = (email, password) => api("/api/auth/login", { method: "POST", body: { email, password } });
export const yo = () => api("/api/auth/yo");
export const cambiarPassword = (actual, nueva) => api("/api/auth/password", { method: "PUT", body: { actual, nueva } });
