const ICON = {
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  plus: "M12 5v14M5 12h14",
  route: "M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  out: "M9 4H5v16h4M16 8l4 4-4 4M20 12H9",
  go: "M5 12h14M13 6l6 6-6 6",
  tag: "M20 12l-8 8-9-9V4h7zM7.5 7.5h.01",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  truck: "M1 5h14v11H1zM15 9h4l3 3v4h-7M5.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  store:"M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6",
  users: "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75",
};

export default function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON[name]} />
      {name === "route" && <><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /></>}
    </svg>
  );
}
