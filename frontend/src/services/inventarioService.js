import { api } from "./api";

export const listar = () => api("/api/inventario");
export const ingresar = (body) => api("/api/inventario", { method: "POST", body });
