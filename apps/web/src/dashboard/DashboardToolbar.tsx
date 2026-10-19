import { Search } from "lucide-react";
import {
  DENSITIES,
  FILTER_LABELS,
  FILTERS,
  SORT_LABELS,
  SORTS,
  type Density,
  type Filter,
  type Sort,
} from "./view.js";

interface DashboardToolbarProps {
  query: string;
  onQuery: (query: string) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  density: Density;
  onDensity: (density: Density) => void;
}

const DENSITY_LABELS: Record<Density, string> = { comfy: "Comfy", compact: "Compact" };

/** Search, filter, sort and density for the card grid. */
export function DashboardToolbar(props: DashboardToolbarProps) {
  return (
    <div data-mt="dashboard-toolbar" role="toolbar" aria-label="Dashboard view">
      <label data-mt="dashboard-search">
        <Search data-mt="icon" aria-hidden focusable={false} />
        <input
          type="search"
          placeholder="Search nodes"
          aria-label="Search nodes"
          value={props.query}
          onChange={(e) => {
            props.onQuery(e.target.value);
          }}
        />
      </label>
      <Segmented
        hook="dashboard-filter"
        label="Filter"
        options={FILTERS}
        labels={FILTER_LABELS}
        value={props.filter}
        onChange={props.onFilter}
      />
      <label data-mt="dashboard-sort">
        <span data-mt="dashboard-sort-label">Sort</span>
        <select
          value={props.sort}
          onChange={(e) => {
            props.onSort(e.target.value as Sort);
          }}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <Segmented
        hook="dashboard-density"
        label="Density"
        options={DENSITIES}
        labels={DENSITY_LABELS}
        value={props.density}
        onChange={props.onDensity}
      />
    </div>
  );
}

interface SegmentedProps<T extends string> {
  hook: string;
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
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
    <div data-mt={hook} role="group" aria-label={label}>
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
