import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import Icon from "./Icon";

/** Encabezado de la tienda (marca, navegación, cuenta y carrito) + contenido + pie. */
export default function Layout() {
  const { cliente, cerrarSesion: cerrar } = useAuth();
  const { unidades } = useCart();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);

  const cerrarSesion = () => { cerrar(); setMenu(false); navigate("/"); };

  return (
    <>
      <header className="top">
        <div className="top-in">
          <Link to="/" className="mark" aria-label="Inicio de la tienda">distribuidora<i>.</i></Link>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/" end>Catálogo</NavLink>
            {cliente && <NavLink to="/pedidos">Mis pedidos</NavLink>}
            {cliente && <NavLink to="/devoluciones">Devoluciones</NavLink>}
          </nav>
          <div className="top-acts">
            {cliente ? (
              <div className="cuenta">
                <button className="btn mini" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  <Icon name="user" /> <span className="hide-sm">{cliente.nombre}</span>
                </button>
                {menu && (
                  <div className="menu" onMouseLeave={() => setMenu(false)}>
                    <Link to="/perfil" onClick={() => setMenu(false)}>Mi perfil</Link>
                    <Link to="/pedidos" onClick={() => setMenu(false)}>Mis pedidos</Link>
                    <Link to="/devoluciones" onClick={() => setMenu(false)}>Devoluciones</Link>
                    <button onClick={cerrarSesion}>Cerrar sesión</button>
                  </div>
                )}
              </div>
            ) : (
              <Link className="btn mini" to="/login"><Icon name="user" /> <span className="hide-sm">Iniciar sesión</span></Link>
            )}
            <Link className="btn mini pri carrito" to="/carrito" aria-label={`Carrito, ${unidades} prendas`}>
              <Icon name="bag" /> <span>{unidades}</span>
            </Link>
          </div>
        </div>
      </header>
      <main id="app"><Outlet /></main>
      <footer className="pie muted sm">
        Envíos desde nuestras sucursales · Pagos seguros con tarjeta (Stripe) · Cambios y devoluciones desde “Mis pedidos”.
      </footer>
    </>
  );
}
