// Reflejan los roles del backend; el servidor siempre valida.
// DISTRITAL (gerente distrital) ve y opera todas las sucursales; ADMIN (gerente de sucursal),
// CAJERO y BODEGUERO solo la suya. El catálogo (prendas y tipos) y las sucursales los maneja el DISTRITAL.
const GERENTES = ["DISTRITAL", "ADMIN"];
export const PERMISOS = {
  aprobar: GERENTES, rechazar: GERENTES,
  recibir: [...GERENTES, "BODEGUERO"], revisar: [...GERENTES, "BODEGUERO"],
  reintegrar: [...GERENTES, "BODEGUERO"], cambiar: [...GERENTES, "BODEGUERO"],
  crear: [...GERENTES, "CAJERO"],
  // Catálogo y stock: lo abren gerentes y bodega; crear/editar prendas y tipos, solo el DISTRITAL.
  catalogo: [...GERENTES, "BODEGUERO"], editarCatalogo: ["DISTRITAL"],
  // Sucursales: ver y ajustar stock gerentes y bodega; abrir, editar o cerrar sucursales, el DISTRITAL.
  sucursales: [...GERENTES, "BODEGUERO"], ajustarStock: [...GERENTES, "BODEGUERO"], gestionarSucursales: ["DISTRITAL"],
  empleados: GERENTES,
  reportes: GERENTES,
  // Pedidos: todos los ven; vender y cobrar es de caja; despachar y entregar, de bodega
  // (igual que PUESTOS_POR_ESTADO del backend). Clientes: caja. Proveedores: bodega.
  vender: [...GERENTES, "CAJERO"], cobrar: [...GERENTES, "CAJERO"],
  CANCELADO: [...GERENTES, "CAJERO"], ENVIADO: [...GERENTES, "BODEGUERO"], ENTREGADO: [...GERENTES, "BODEGUERO"],
  clientes: [...GERENTES, "CAJERO"], activarCliente: GERENTES,
  proveedores: [...GERENTES, "BODEGUERO"], eliminarProveedor: GERENTES,
  // Ver todas las sucursales (filtros por sucursal, reportes globales).
  todasLasSucursales: ["DISTRITAL"],
  // Estado del sistema: salud de la base, migraciones y errores del servidor.
  sistema: ["DISTRITAL"],
  // Promociones (cupones de descuento): las define el distrital para todas las sucursales.
  promociones: ["DISTRITAL"],
};

export const ROLES = ["DISTRITAL", "ADMIN", "CAJERO", "BODEGUERO"];
export const rolDe = (sesion) => ((sesion || {}).puesto || "").trim().toUpperCase();
export const puede = (rol, accion) => PERMISOS[accion].includes(rol);

// Acciones disponibles según el estado (y tipo) de la devolución.
export function accionesDe(d) {
  switch (d.estado) {
    case "SOLICITADA": return ["aprobar", "rechazar"];
    case "APROBADA": return ["recibir"];
    case "RECIBIDA": return ["revisar"];
    case "ACEPTADA": return [d.tipo === "DEVOLUCION" ? "reintegrar" : "cambiar"];
    default: return [];
  }
}
