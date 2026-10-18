import { useEffect } from "react";
import { useCart } from "../context/CartContext";
import useFetch from "../hooks/useFetch";
import * as catalogoService from "../services/catalogoService";
import Select from "./Select";

/** Sucursal desde la que se despacha el pedido: define el stock que se muestra y se descuenta. */
export default function SelectorSucursal({ className = "pill" }) {
  const { id_sucursal, elegirSucursal } = useCart();
  const sucursales = useFetch(() => catalogoService.sucursales(), []);
  const lista = sucursales.data || [];

  // Si no hay una elegida (o la guardada ya no existe/está inactiva), se toma la primera.
  useEffect(() => {
    if (lista.length && !lista.some((s) => s.id_sucursal === id_sucursal)) elegirSucursal(lista[0].id_sucursal);
  }, [lista, id_sucursal, elegirSucursal]);

  if (sucursales.error) return <span className="err sm">{sucursales.error}</span>;
  return (
    <label className="sucursal sm muted">
      Enviar desde
      <Select className={className} value={id_sucursal || ""} onChange={(e) => elegirSucursal(e.target.value)}
        options={lista.map((s) => [s.id_sucursal, `${s.nombre}${s.ciudad ? ", " + s.ciudad : ""}`])} />
    </label>
  );
}
