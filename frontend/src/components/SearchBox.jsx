import Icon from "./Icon";

export default function SearchBox({ onSubmit, label, ...input }) {
  return (
    <form className="search" onSubmit={(ev) => { ev.preventDefault(); onSubmit?.(); }}>
      <input aria-label={label} {...input} />
      <button className="go" aria-label="Buscar"><Icon name="go" /></button>
    </form>
  );
}
