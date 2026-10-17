/** <select> con opción placeholder. `options` = [valor, etiqueta]. */
export default function Select({ options, placeholder, ...props }) {
  return (
    <select {...props}>
      <option value="">{placeholder}</option>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
}
