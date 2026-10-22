import { api } from "./api";

export const login = (email, password) => api("/api/tienda/auth/login", { method: "POST", body: { email, password } });
export const registro = (datos) => api("/api/tienda/auth/registro", { method: "POST", body: datos });
/** Cliente registrado en caja: crea su contraseña con el código que le entregaron. */
export const activar = (datos) => api("/api/tienda/auth/activar", { method: "POST", body: datos });
export const perfil = () => api("/api/tienda/perfil");
export const actualizarPerfil = (datos) => api("/api/tienda/perfil", { method: "PUT", body: datos });
