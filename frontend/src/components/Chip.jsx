import { ESTADOS, TONO } from "../utils/constants";

export function ChipEstado({ estado }) {
  return <span className={`st ${TONO[estado] || ""}`}>{ESTADOS[estado] || estado}</span>;
}

/** Fila de botones-filtro. `items` = [valor, etiqueta]. */
export function ChipBar({ items, value, onChange }) {
  return (
    <div className="bar">
      {items.map(([v, t]) => (
        <button key={v} type="button" className={`chip ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>{t}</button>
      ))}
    </div>
  );
}
