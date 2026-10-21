import type {
  ConfigSnapshotSummary,
  FixedPosition,
  ParsedChannelUrlDTO,
  ProtoJson,
} from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Download, TriangleAlert, Upload, X } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { formatAbsolute } from "../../dashboard/format.js";
import { ApiError, api } from "../../data/api.js";
import { useUiStore } from "../../data/ui-store.js";
import { importEdits } from "./ChannelLinkDialogs.js";
import { stage, type FieldContext } from "./field-props.js";
import { formatChange, labelFor } from "./format.js";
import { allSections, metaFor, sectionOf } from "./registry.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** What a backup file or a snapshot would set. */
export interface RestoreSource {
  title: string;
  owner: ProtoJson | null;
  config: Record<string, ProtoJson>;
  moduleConfig: Record<string, ProtoJson>;
  /** From a channel link (backup files) or whole channels (snapshots). */
  channels: { link: ParsedChannelUrlDTO } | { list: ProtoJson[] } | null;
  fixedPosition: FixedPosition | null;
  unknown: string[];
}

/** Network and Security changes must be opted into (CR-002 §5.7). */
const OPT_IN = new Set(["network", "security"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function leaves(obj: unknown, prefix: string, out: [string, unknown][]): void {
  if (!isObject(obj)) {
    out.push([prefix, obj]);
    return;
  }
  for (const [k, v] of Object.entries(obj)) leaves(v, `${prefix}.${k}`, out);
}

/** The edits that make the node look like the source: only fields that differ. */
export function restoreEdits(source: RestoreSource, get: (path: string) => unknown) {
  const all: [string, unknown][] = [];
  if (source.owner) {
    for (const [k, v] of Object.entries(source.owner)) all.push([`owner.${k}`, v]);
  }
  for (const [section, obj] of Object.entries(source.config)) leaves(obj, `config.${section}`, all);
  for (const [section, obj] of Object.entries(source.moduleConfig)) {
    leaves(obj, `moduleConfig.${section}`, all);
  }
  if (source.channels && "link" in source.channels) {
    all.push(...importEdits(source.channels.link, "replace", false, get));
  } else if (source.channels) {
    for (const channel of source.channels.list) {
      const index = typeof channel.index === "number" ? channel.index : 0;
      all.push([`channels.${index}.role`, channel.role]);
      leaves(channel.settings ?? {}, `channels.${index}.settings`, all);
    }
  }
  if (source.fixedPosition) {
    all.push(["config.position.fixedPosition", true]);
    all.push(["fixedPosition.lat", source.fixedPosition.lat]);
    all.push(["fixedPosition.lon", source.fixedPosition.lon]);
    if (source.fixedPosition.alt !== undefined)
      all.push(["fixedPosition.alt", source.fixedPosition.alt]);
  }
  return all.filter(([path, value]) => {
    const meta = metaFor(path);
    // Identity and keys aren't restored: they belong to this node.
    if (meta.readOnly || meta.hidden) return false;
    return JSON.stringify(get(path)) !== JSON.stringify(value);
  });
}

interface RestoreReviewProps {
  source: RestoreSource | null;
  onClose: () => void;
  ctx: FieldContext;
  moduleKeys: string[];
}

/** The changes a backup or snapshot makes, by section, to stage for the normal review. */
export function RestoreReview({ source, onClose, ctx, moduleKeys }: RestoreReviewProps) {
  const toast = useUiStore((s) => s.toast);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const planned = source ? restoreEdits(source, ctx.get) : [];
  const sections = allSections(moduleKeys)
    .map((s) => ({ section: s, rows: planned.filter(([p]) => sectionOf(p) === s.id) }))
    .filter((g) => g.rows.length > 0);
  const on = (id: string) => chosen[id] ?? !OPT_IN.has(id);
  const staged = sections.filter((g) => on(g.section.id)).flatMap((g) => g.rows);

  return (
    <Dialog.Root
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) {
          setChosen({});
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="review-dialog"
          data-mt-variant="restore"
          aria-describedby={undefined}
        >
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">{source?.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <div data-mt="review-body">
            {sections.length === 0 ? (
              <p data-mt="review-note">Nothing to change: the node already has these settings.</p>
            ) : (
              sections.map(({ section, rows }) => (
                <section key={section.id} data-mt="review-section" aria-label={section.title}>
                  <label data-mt="check-row">
                    <input
                      type="checkbox"
                      checked={on(section.id)}
                      onChange={(e) => {
                        setChosen((c) => ({ ...c, [section.id]: e.target.checked }));
                      }}
                    />
                    <strong>{section.title}</strong> ({rows.length})
                    {OPT_IN.has(section.id) && (
                      <span data-mt="danger-tag" data-mt-variant="lockout">
                        <TriangleAlert data-mt="icon" {...ICON} /> can disconnect MeshTerm
                      </span>
                    )}
                  </label>
                  <table data-mt="review-table">
                    <tbody>
                      {rows.map(([path, value]) => {
                        const [from, to] = formatChange(path, ctx.get(path), value);
                        return (
                          <tr key={path} data-mt="diff-row" data-path={path}>
                            <th scope="row">{labelFor(path, ctx.get)}</th>
                            <td data-mt="diff-from">{from}</td>
                            <td data-mt="diff-arrow" aria-label="to">
                              →
                            </td>
                            <td data-mt="diff-to">{to}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              ))
            )}
            {source && source.unknown.length > 0 && (
              <p data-mt="review-note">
                Skipped (MeshTerm doesn&apos;t know them): {source.unknown.join(", ")}.
              </p>
            )}
          </div>
          <footer data-mt="review-actions">
            <Dialog.Close asChild>
              <button type="button" data-mt="button">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-mt="button"
              data-mt-variant="primary"
              disabled={staged.length === 0 || ctx.disabled}
              onClick={() => {
                for (const [path, value] of staged) stage(ctx, path, value);
                toast(`${staged.length} changes staged: review and apply them.`, "success");
                setChosen({});
                onClose();
              }}
            >
              Stage {staged.length} {staged.length === 1 ? "change" : "changes"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const REASONS: Record<ConfigSnapshotSummary["reason"], string> = {
  "pre-apply": "Before an apply",
  "pre-maintenance": "Before maintenance",
  manual: "Manual",
};

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.";

/** Backup & restore (CR-002 §5.7): YAML export and import, and the automatic snapshots. */
export function BackupRestore({ ctx, moduleKeys }: { ctx: FieldContext; moduleKeys: string[] }) {
  const toast = useUiStore((s) => s.toast);
  const id = ctx.connectionId ?? 0;
  const [secrets, setSecrets] = useState(false);
  const [source, setSource] = useState<RestoreSource | null>(null);
  const snapshots = useQuery({
    queryKey: ["configSnapshots", id],
    queryFn: () => api.snapshots(id),
    enabled: ctx.connectionId !== null,
    staleTime: 0,
  });

  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = await api.importConfig(id, await file.text());
      setSource({
        title: `Import ${file.name}`,
        owner: parsed.owner,
        config: parsed.config,
        moduleConfig: parsed.moduleConfig,
        channels: parsed.channels ? { link: parsed.channels } : null,
        fixedPosition: parsed.fixedPosition,
        unknown: parsed.unknown,
      });
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function restore(snap: ConfigSnapshotSummary) {
    try {
      const data = await api.snapshot(id, snap.id);
      setSource({
        title: `Restore the snapshot of ${formatAbsolute(snap.takenAt)}`,
        owner: data.owner,
        config: data.config,
        moduleConfig: data.moduleConfig,
        channels: { list: data.channels },
        fixedPosition: null,
        unknown: [],
      });
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  return (
    <div data-mt="backup-restore">
      <fieldset data-mt="config-group">
        <legend data-mt="config-group-title">Export</legend>
        <p data-mt="config-help">
          A YAML file in the Meshtastic CLI&apos;s <code>--export-config</code> format: owner, every
          config and module section, and the fixed position.
        </p>
        <label data-mt="check-row">
          <input
            type="checkbox"
            checked={secrets}
            onChange={(e) => {
              setSecrets(e.target.checked);
            }}
          />
          Include secrets (channel keys and link, Wi-Fi password, private key, MQTT password)
        </label>
        {secrets && (
          <p data-mt="config-warning">
            <TriangleAlert data-mt="icon" {...ICON} /> Anyone with the file can read your channels
            and join your Wi-Fi.
          </p>
        )}
        <a data-mt="button" href={api.exportConfigUrl(id, secrets)} download>
          <Download data-mt="icon" {...ICON} /> Download backup
        </a>
      </fieldset>

      <fieldset data-mt="config-group">
        <legend data-mt="config-group-title">Import</legend>
        <p data-mt="config-help">
          A file from MeshTerm or the CLI. You see what it changes first; Network and Security are
          left out unless you tick them.
        </p>
        <label data-mt="button" data-mt-variant="file">
          <Upload data-mt="icon" {...ICON} /> Choose a YAML file…
          <input
            type="file"
            accept=".yaml,.yml,application/yaml,text/yaml"
            data-mt="visually-hidden"
            disabled={ctx.disabled}
            onChange={(e) => void readFile(e)}
          />
        </label>
      </fieldset>

      <fieldset data-mt="config-group">
        <legend data-mt="config-group-title">Snapshots</legend>
        <p data-mt="config-help">
          MeshTerm saves the node&apos;s whole config (encrypted) before every apply and maintenance
          action; the newest 20 are kept.
        </p>
        {snapshots.isPending ? (
          <div data-mt="skeleton" aria-hidden />
        ) : snapshots.isError ? (
          <p role="alert">Snapshots couldn&apos;t be loaded.</p>
        ) : snapshots.data.length === 0 ? (
          <p data-mt="review-note">No snapshots yet.</p>
        ) : (
          <table data-mt="snapshot-table">
            <thead>
              <tr>
                <th scope="col">Taken</th>
                <th scope="col">Why</th>
                <th scope="col">Firmware</th>
                <th scope="col">
                  <span data-mt="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshots.data.map((snap) => (
                <tr key={snap.id} data-mt="snapshot-row" data-mt-variant={snap.reason}>
                  <td>{formatAbsolute(snap.takenAt)}</td>
                  <td>{REASONS[snap.reason]}</td>
                  <td>{snap.firmware ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      data-mt="button"
                      disabled={ctx.disabled}
                      onClick={() => void restore(snap)}
                    >
                      Restore…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      <RestoreReview
        source={source}
        onClose={() => {
          setSource(null);
        }}
        ctx={ctx}
        moduleKeys={moduleKeys}
      />
    </div>
  );
}
