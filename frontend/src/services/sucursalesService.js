import { api } from "./api";

// Si el usuario no puede consultar sucursales se devuelve lista vacía y la UI usa el número.
export const listar = () => api("/api/sucursales").catch(() => []);
