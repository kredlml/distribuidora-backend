import { api } from "./api";

export const login = (email, password) => api("/api/tienda/auth/login", { method: "POST", body: { email, password } });
export const registro = (datos) => api("/api/tienda/auth/registro", { method: "POST", body: datos });
export const perfil = () => api("/api/tienda/perfil");
export const actualizarPerfil = (datos) => api("/api/tienda/perfil", { method: "PUT", body: datos });
