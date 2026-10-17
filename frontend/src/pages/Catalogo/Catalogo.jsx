import { useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import useFetch from "../../hooks/useFetch";
import * as categoriasService from "../../services/categoriasService";
import * as productosService from "../../services/productosService";
import * as sucursalesService from "../../services/sucursalesService";
import PrendasTab from "./PrendasTab";
import StockTab from "./StockTab";
import TiposTab from "./TiposTab";

const TABS = [["prenda", "Nueva prenda"], ["stock", "Ingresar stock"], ["tipos", "Tipos de prenda"]];

export default function Catalogo() {
  const [tab, setTab] = useState("prenda");
  const { data, error, loading, reload } = useFetch(async () => {
    const [cats, prods, sucs] = await Promise.all([categoriasService.listar(), productosService.listar(), sucursalesService.listar()]);
    return { cats, prods, sucs };
  }, []);

  return (
    <>
      <div className="head">
        <div><h1>Catálogo y stock</h1><div className="muted sm">Registra prendas, tipos de prenda e ingresos de inventario.</div></div>
      </div>
      <ChipBar items={TABS} value={tab} onChange={setTab} />
      <div className="stack">
        {loading && !data ? <Cargando>Cargando…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : tab === "prenda" ? <PrendasTab {...data} reload={reload} />
          : tab === "stock" ? <StockTab {...data} reload={reload} />
          : <TiposTab {...data} reload={reload} />}
      </div>
    </>
  );
}
