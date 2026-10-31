import { api } from "./api";

/** DISTRITAL: base, migraciones, pendientes, servicios configurados y conteo de errores. */
export const detalle = () => api("/api/salud/detalle");
/** DISTRITAL: errores registrados del servidor, paginados. */
export const errores = (pagina = 1) => api(`/api/salud/errores?pagina=${pagina}`);
