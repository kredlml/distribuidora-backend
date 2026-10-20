import { api } from "./api";

// Si el usuario no puede consultar sucursales se devuelve lista vacía y la UI usa el número.
export const listar = () => api("/api/sucursales").catch(() => []);
// Para la pantalla Sucursales: aquí un error sí debe mostrarse.
export const listarOFallar = () => api("/api/sucursales");
export const crear = (body) => api("/api/sucursales", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/sucursales/${id}`, { method: "PUT", body });
export const eliminar = (id) => api(`/api/sucursales/${id}`, { method: "DELETE" });
