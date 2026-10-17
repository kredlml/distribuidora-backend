import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import RoleRoute from "./components/RoleRoute";
import Catalogo from "./pages/Catalogo/Catalogo";
import DevolucionDetalle from "./pages/DevolucionDetalle/DevolucionDetalle";
import Devoluciones from "./pages/Devoluciones/Devoluciones";
import Inventario from "./pages/Inventario/Inventario";
import Login from "./pages/Login/Login";
import NuevaSolicitud from "./pages/NuevaSolicitud/NuevaSolicitud";
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
