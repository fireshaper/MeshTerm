import { LayoutGrid, Rows3, Search } from "lucide-react";
import type { ReactNode } from "react";
import { roleLabel } from "./labels.js";
import type { NodesView } from "./prefs.js";
import {
  DENSITIES,
  FILTER_LABELS,
  FILTERS,
  POWER_FILTERS,
  POWER_LABELS,
  SORT_LABELS,
  SORTS,
  type Density,
  type Filter,
  type PowerFilter,
  type Sort,
} from "./view.js";

interface NodesToolbarProps {
  query: string;
  onQuery: (query: string) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  /** Roles present in the node DB, for the role filter. */
  roles: readonly string[];
  role: string | null;
  onRole: (role: string | null) => void;
  power: PowerFilter;
  onPower: (power: PowerFilter) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  view: NodesView;
  onView: (view: NodesView) => void;
  density: Density;
  onDensity: (density: Density) => void;
  /** Extra controls for the current view (the table's column picker). */
  children?: ReactNode;
}

const DENSITY_LABELS: Record<Density, string> = { comfy: "Comfy", compact: "Compact" };
const VIEW_LABELS: Record<NodesView, ReactNode> = {
  cards: (
    <>
      <LayoutGrid data-mt="icon" aria-hidden focusable={false} />
      Cards
    </>
  ),
  table: (
    <>
      <Rows3 data-mt="icon" aria-hidden focusable={false} />
      Table
    </>
  ),
};

/** Search, filters, sort and view for the node inventory. */
export function NodesToolbar(props: NodesToolbarProps) {
  return (
    <div data-mt="nodes-toolbar" role="toolbar" aria-label="Node view">
      <div data-mt="toolbar-row">
        <label data-mt="dashboard-search">
          <Search data-mt="icon" aria-hidden focusable={false} />
          <input
            type="search"
            placeholder="Search name, short name, ID or hardware"
            aria-label="Search nodes"
            value={props.query}
            onChange={(e) => {
              props.onQuery(e.target.value);
            }}
          />
        </label>
        <Segmented
          hook="nodes-view"
          label="View"
          options={["cards", "table"] as const}
          labels={VIEW_LABELS}
          value={props.view}
          onChange={props.onView}
        />
      </div>
      <div data-mt="toolbar-row">
        <Segmented
          hook="dashboard-filter"
          label="Filter"
          options={FILTERS}
          labels={FILTER_LABELS}
          value={props.filter}
          onChange={props.onFilter}
        />
        <Select
          hook="role-filter"
          label="Role"
          value={props.role ?? ""}
          onChange={(v) => {
            props.onRole(v === "" ? null : v);
          }}
          options={[
            ["", "All roles"],
            ...props.roles.map((r): [string, string] => [r, roleLabel(r)]),
          ]}
        />
        <Select
          hook="power-filter"
          label="Power"
          value={props.power}
          onChange={(v) => {
            props.onPower(v as PowerFilter);
          }}
          options={POWER_FILTERS.map((p): [string, string] => [p, POWER_LABELS[p]])}
        />
        <Select
          hook="dashboard-sort"
          label="Sort"
          value={props.sort}
          onChange={(v) => {
            props.onSort(v as Sort);
          }}
          options={SORTS.map((s): [string, string] => [s, SORT_LABELS[s]])}
        />
        {props.view === "cards" ? (
          <Segmented
            hook="dashboard-density"
            label="Density"
            options={DENSITIES}
            labels={DENSITY_LABELS}
            value={props.density}
            onChange={props.onDensity}
          />
        ) : null}
        {props.children}
      </div>
    </div>
  );
}

interface SelectProps {
  hook: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}

function Select({ hook, label, value, onChange, options }: SelectProps) {
  return (
    <label data-mt={hook} data-mt-variant="select">
      <span data-mt="select-label">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

interface SegmentedProps<T extends string> {
  hook: string;
  label: string;
  options: readonly T[];
  labels: Record<T, ReactNode>;
  value: T;
  onChange: (value: T) => void;
}

/** A row of toggle buttons where exactly one is pressed. */
function Segmented<T extends string>({
  hook,
  label,
  options,
  labels,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div data-mt={hook} data-mt-variant="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          data-mt="segment"
          data-mt-variant={option}
          data-mt-state={option === value ? "active" : "inactive"}
          aria-pressed={option === value}
          onClick={() => {
            onChange(option);
          }}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
