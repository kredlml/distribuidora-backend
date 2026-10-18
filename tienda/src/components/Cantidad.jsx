/** Selector de cantidad − n + acotado a [1, max]. */
export default function Cantidad({ value, max, onChange, label = "Cantidad" }) {
  const tope = Math.max(1, max || 1);
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" aria-label="Quitar una" disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Agregar una" disabled={value >= tope} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}
