import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import RoleRoute from "./components/RoleRoute";
import Catalogo from "./pages/Catalogo/Catalogo";
import Clientes from "./pages/Clientes/Clientes";
import NuevaVenta from "./pages/NuevaVenta/NuevaVenta";
import PedidoDetalle from "./pages/PedidoDetalle/PedidoDetalle";
import Pedidos from "./pages/Pedidos/Pedidos";
import Proveedores from "./pages/Proveedores/Proveedores";
import Reportes from "./pages/Reportes/Reportes";
import DevolucionDetalle from "./pages/DevolucionDetalle/DevolucionDetalle";
import Devoluciones from "./pages/Devoluciones/Devoluciones";
import Empleados from "./pages/Empleados/Empleados";
import Inventario from "./pages/Inventario/Inventario";
import Login from "./pages/Login/Login";
import NuevaSolicitud from "./pages/NuevaSolicitud/NuevaSolicitud";
import Sucursales from "./pages/Sucursales/Sucursales";
import Trazabilidad from "./pages/Trazabilidad/Trazabilidad";
import { PERMISOS } from "./utils/permisos";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route index element={<Devoluciones />} />
        <Route path="devolucion/:id" element={<DevolucionDetalle />} />
        <Route path="nueva" element={<NuevaSolicitud />} />
        <Route path="trazabilidad" element={<Trazabilidad />} />
        <Route path="inventario" element={<Inventario />} />
        <Route path="catalogo" element={
          <RoleRoute roles={PERMISOS.catalogo} mensaje="Esta sección es solo para ADMIN o BODEGUERO."><Catalogo /></RoleRoute>
        } />
        <Route path="reportes" element={
          <RoleRoute roles={PERMISOS.reportes} mensaje="Los reportes de ventas son para el gerente de sucursal y el distrital."><Reportes /></RoleRoute>
        } />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="pedidos/nueva" element={
          <RoleRoute roles={PERMISOS.vender} mensaje="Registrar ventas es solo para ADMIN o CAJERO."><NuevaVenta /></RoleRoute>
        } />
        <Route path="pedidos/:id" element={<PedidoDetalle />} />
        <Route path="clientes" element={
          <RoleRoute roles={PERMISOS.clientes} mensaje="Esta sección es solo para ADMIN o CAJERO."><Clientes /></RoleRoute>
        } />
        <Route path="proveedores" element={
          <RoleRoute roles={PERMISOS.proveedores} mensaje="Esta sección es solo para ADMIN o BODEGUERO."><Proveedores /></RoleRoute>
        } />
        <Route path="sucursales" element={
          <RoleRoute roles={PERMISOS.sucursales} mensaje="Esta sección es solo para ADMIN o BODEGUERO."><Sucursales /></RoleRoute>
        } />
        <Route path="empleados" element={
          <RoleRoute roles={PERMISOS.empleados} mensaje="Esta sección es solo para administradores."><Empleados /></RoleRoute>
        } />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
