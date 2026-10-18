import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import RutaPrivada from "./components/RutaPrivada";
import Carrito from "./pages/Carrito/Carrito";
import Catalogo from "./pages/Catalogo/Catalogo";
import Checkout from "./pages/Checkout/Checkout";
import Login from "./pages/Cuenta/Login";
import Perfil from "./pages/Cuenta/Perfil";
import Registro from "./pages/Cuenta/Registro";
import DevolucionDetalle from "./pages/Devoluciones/DevolucionDetalle";
import MisDevoluciones from "./pages/Devoluciones/MisDevoluciones";
import SolicitarDevolucion from "./pages/Devoluciones/SolicitarDevolucion";
import Pedido from "./pages/Pedido/Pedido";
import MisPedidos from "./pages/Pedidos/MisPedidos";
import Prenda from "./pages/Prenda/Prenda";

const privada = (el) => <RutaPrivada>{el}</RutaPrivada>;

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Catalogo />} />
        <Route path="prenda/:id" element={<Prenda />} />
        <Route path="carrito" element={<Carrito />} />
        <Route path="login" element={<Login />} />
        <Route path="registro" element={<Registro />} />
        <Route path="checkout" element={privada(<Checkout />)} />
        <Route path="perfil" element={privada(<Perfil />)} />
        <Route path="pedidos" element={privada(<MisPedidos />)} />
        <Route path="pedidos/:id" element={privada(<Pedido />)} />
        <Route path="pedidos/:id/devolucion" element={privada(<SolicitarDevolucion />)} />
        <Route path="devoluciones" element={privada(<MisDevoluciones />)} />
        <Route path="devoluciones/:id" element={privada(<DevolucionDetalle />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
