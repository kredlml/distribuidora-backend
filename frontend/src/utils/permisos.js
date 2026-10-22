// Reflejan los roles del backend; el servidor siempre valida.
export const PERMISOS = {
  aprobar: ["ADMIN"], rechazar: ["ADMIN"],
  recibir: ["ADMIN", "BODEGUERO"], revisar: ["ADMIN", "BODEGUERO"],
  reintegrar: ["ADMIN", "BODEGUERO"], cambiar: ["ADMIN", "BODEGUERO"],
  crear: ["ADMIN", "CAJERO"],
  catalogo: ["ADMIN", "BODEGUERO"],
  // Sucursales: ver y ajustar stock ADMIN/BODEGUERO; crear, editar y eliminar sucursales solo ADMIN.
  sucursales: ["ADMIN", "BODEGUERO"], ajustarStock: ["ADMIN", "BODEGUERO"], gestionarSucursales: ["ADMIN"],
  empleados: ["ADMIN"],
  // Pedidos: todos los ven; vender y cobrar es de caja; despachar y entregar, de bodega
  // (igual que PUESTOS_POR_ESTADO del backend). Clientes: caja. Proveedores: bodega.
  vender: ["ADMIN", "CAJERO"], cobrar: ["ADMIN", "CAJERO"],
  CANCELADO: ["ADMIN", "CAJERO"], ENVIADO: ["ADMIN", "BODEGUERO"], ENTREGADO: ["ADMIN", "BODEGUERO"],
  clientes: ["ADMIN", "CAJERO"], activarCliente: ["ADMIN"],
  proveedores: ["ADMIN", "BODEGUERO"], eliminarProveedor: ["ADMIN"],
};

export const ROLES = ["ADMIN", "CAJERO", "BODEGUERO"];
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
