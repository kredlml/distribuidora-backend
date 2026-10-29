import { useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as categoriasService from "../../services/categoriasService";
import * as productosService from "../../services/productosService";
import * as sucursalesService from "../../services/sucursalesService";
import { puede } from "../../utils/permisos";
import PrendasTab from "./PrendasTab";
import StockTab from "./StockTab";
import TiposTab from "./TiposTab";

export default function Catalogo() {
  const { rol } = useAuth();
  // El catálogo es único para todas las sucursales: solo el distrital lo edita; las sucursales lo
  // consultan e ingresan stock en la suya.
  const edita = puede(rol, "editarCatalogo");
  const tabs = edita
    ? [["prenda", "Nueva prenda"], ["stock", "Ingresar stock"], ["tipos", "Tipos de prenda"]]
    : [["stock", "Ingresar stock"], ["prenda", "Prendas"], ["tipos", "Tipos de prenda"]];
  const [tab, setTab] = useState(tabs[0][0]);
  const { data, error, loading, reload } = useFetch(async () => {
    const [cats, prods, sucs] = await Promise.all([categoriasService.listar(), productosService.listar(), sucursalesService.listar()]);
    return { cats, prods, sucs };
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Catálogo y stock</h1>
          <div className="muted sm">{edita
            ? "Catálogo de todas las sucursales: prendas, tipos de prenda e ingresos de inventario."
            : "El catálogo lo administra el gerente distrital. Aquí ingresas el stock de tu sucursal."}</div>
        </div>
      </div>
      <ChipBar items={tabs} value={tab} onChange={setTab} />
      <div className="stack">
        {loading && !data ? <Cargando>Cargando…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : tab === "prenda" ? <PrendasTab {...data} reload={reload} edita={edita} />
          : tab === "stock" ? <StockTab {...data} reload={reload} />
          : <TiposTab {...data} reload={reload} edita={edita} />}
      </div>
    </>
  );
}
