import { api } from "./api";

export const login = (email, password) => api("/api/tienda/auth/login", { method: "POST", body: { email, password } });
export const registro = (datos) => api("/api/tienda/auth/registro", { method: "POST", body: datos });
/** Cliente registrado en caja: crea su contraseña con el código que le entregaron. */
export const activar = (datos) => api("/api/tienda/auth/activar", { method: "POST", body: datos });
/** Envía al correo un enlace de un solo uso (la respuesta es la misma exista o no la cuenta). */
export const olvide = (email) => api("/api/tienda/auth/olvide", { method: "POST", body: { email } });
/** Con el enlace del correo: { email, token, password } -> { token, cliente }. */
export const restablecer = (datos) => api("/api/tienda/auth/restablecer", { method: "POST", body: datos });
/** Con sesión: { actual, nueva } -> { token } (las demás sesiones se cierran). */
export const cambiarPassword = (actual, nueva) => api("/api/tienda/perfil/password", { method: "PUT", body: { actual, nueva } });
export const perfil = () => api("/api/tienda/perfil");
export const actualizarPerfil = (datos) => api("/api/tienda/perfil", { method: "PUT", body: datos });
