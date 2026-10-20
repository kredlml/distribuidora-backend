import { api } from "./api";

export const listar = () => api("/api/empleados");
/** Alta con contraseña (puede iniciar sesión). Solo ADMIN. */
export const registrar = (body) => api("/api/auth/registro", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/empleados/${id}`, { method: "PUT", body });
export const restablecerPassword = (id, password) => api(`/api/empleados/${id}/password`, { method: "PUT", body: { password } });
