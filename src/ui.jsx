export { sortRows } from "./table.js";
import { serializeCSV } from "./csv.js";
import { Activity, ArrowDownUp } from "lucide-react";

export const tone = (n) =>
  Number.isFinite(n) ? (n >= 0 ? "positive" : "negative") : "muted";
export function PanelTitle({ title, tag, children }) {
  return (
    <div className="panel-title">
      <div>
        <span className="panel-tag">{tag}</span>
        <h2>{title}</h2>
      </div>
      <div>{children}</div>
    </div>
  );
}
export function Empty({ title, description, children }) {
  return (
    <div className="empty">
      <Activity size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function exportCSV(rows, filename) {
  const text = serializeCSV(rows);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
/** Sortable header cell; `sort` is [key, direction]. */
export function SortTh({ k, sort, setSort, children, className = "", title }) {
  const active = sort[0] === k;
  return (
    <th
      className={className}
      title={title}
      aria-sort={active ? (sort[1] > 0 ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() =>
          setSort(
            active
              ? [k, -sort[1]]
              : [k, k === "symbol" || k === "name" ? 1 : -1],
          )
        }
      >
        {children} <ArrowDownUp size={11} />
      </button>
    </th>
  );
}
export function MiniBars({ values = [], avg }) {
  const v = values.map((x) => (Number.isFinite(x) ? x : 0));
  if (!v.length) return <span className="muted">—</span>;
  return (
    <svg
      className="mini-bars"
      viewBox={`0 0 ${v.length * 6} 24`}
      aria-hidden="true"
    >
      {Number.isFinite(avg) && (
        <line
          x1="0"
          x2={v.length * 6}
          y1={24 - (avg / 100) * 22}
          y2={24 - (avg / 100) * 22}
          className="avg"
        />
      )}
      {v.map((x, i) => (
        <rect
          key={i}
          x={i * 6 + 1}
          width="4"
          y={24 - (x / 100) * 22}
          height={Math.max(1, (x / 100) * 22)}
          className={i === v.length - 1 ? "last" : ""}
        />
      ))}
    </svg>
  );
}
