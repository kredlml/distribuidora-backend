import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import Select from "../../components/Select";
import Timeline from "../../components/Timeline";
import useFetch from "../../hooks/useFetch";
import * as pedidosService from "../../services/pedidosService";
import * as productosService from "../../services/productosService";
import { fecha, humanizar, prod } from "../../utils/format";

export default function Trazabilidad() {
  const [params, setParams] = useSearchParams();
  const [modoManual, setModoManual] = useState("pedido");
  const modo = params.get("producto") ? "producto" : params.get("pedido") ? "pedido" : modoManual;
  const valor = params.get(modo) || "";
  const [texto, setTexto] = useState(params.get("pedido") || "");

  const productos = useFetch(() => productosService.listar(), [], modo === "producto");
  const res = useFetch(
    () => (modo === "pedido" ? pedidosService.historial(valor) : productosService.historial(valor)),
    [modo, valor],
    !!valor,
  );

  const cambiarModo = (m) => { setModoManual(m); setParams({}); setTexto(""); };
  const consultarPedido = () => { if (texto) setParams({ pedido: texto }); };

  const d = res.data;
  const x = d && (modo === "pedido" ? d.pedido : d.producto);

  return (
    <>
      <div className="head">
        <div><h1>Trazabilidad</h1><div className="muted sm">Historial de movimientos de inventario por pedido o por prenda.</div></div>
      </div>
      <ChipBar items={["pedido", "producto"].map((m) => [m, `Por ${m}`])} value={modo} onChange={cambiarModo} />
      <div className="bar">
        {modo === "pedido" ? (
          <SearchBox label="Número de pedido" type="number" min="1" placeholder="Número de pedido" value={texto}
            onChange={(ev) => setTexto(ev.target.value)} onSubmit={consultarPedido} />
        ) : productos.error ? <p className="err">{productos.error}</p> : (
          <Select className="pill" aria-label="Producto" value={valor} placeholder="Elige un producto"
            onChange={(ev) => ev.target.value && setParams({ producto: ev.target.value })}
            options={(productos.data || []).map((p) => [p.id_producto, `#${p.id_producto} ${prod(p)}`])} />
        )}
      </div>
      <div className="stack">
        {valor && res.loading && !d ? <Cargando>Consultando…</Cargando>
          : res.error ? <ErrorCard message={res.error} />
          : x ? (
            <>
              <section className="card">
                <div className="kv">
                  {modo === "pedido" ? (
                    <>
                      <div><b>Pedido</b>{x.id_pedido}</div>
                      <div><b>Estado</b>{humanizar(x.estado)}</div>
                      <div><b>Fecha</b>{fecha(x.fecha_pedido)}</div>
                      <div><b>Total</b>{x.total != null ? Number(x.total).toFixed(2) : "—"}</div>
                    </>
                  ) : <div><b>Producto</b>#{x.id_producto} {prod(x)}</div>}
                </div>
              </section>
              <section className="card">
                <h2>Movimientos</h2>
                <Timeline movs={d.movimientos || []} conProducto={modo === "pedido"} />
              </section>
            </>
          ) : null}
      </div>
    </>
  );
}
