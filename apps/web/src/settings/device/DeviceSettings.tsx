import { ipv4FromUint32, type ApplyStatusDTO, type FieldSchema } from "@meshterm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useIsAdmin } from "../../auth/me.js";
import { ApiError, api } from "../../data/api.js";
import { queryKeys } from "../../data/keys.js";
import { useConnections, useMapNodes } from "../../data/queries.js";
import { useLiveStore } from "../../data/store.js";
import { useUiStore } from "../../data/ui-store.js";
import { ApplyProgress, TERMINAL } from "./ApplyProgress.js";
import { BackupRestore } from "./BackupRestore.js";
import { ChannelsEditor } from "./ChannelsEditor.js";
import { Maintenance } from "./Maintenance.js";
import { ConfigField } from "./ConfigField.js";
import {
  buildChanges,
  getterFor,
  summarize,
  useEditsStore,
  type ConfigView,
  type Edit,
} from "./edits.js";
import { fieldProps, scalar, stage, type FieldContext } from "./field-props.js";
import { allSections, metaFor, sectionById, type SectionMeta } from "./registry.js";
import { ReviewDialog } from "./ReviewDialog.js";

const NO_EDITS: Record<string, Edit> = {};
/** MapLibre loads only when the picker opens. */
const MapPicker = lazy(() => import("./MapPicker.js").then((m) => ({ default: m.MapPicker })));

/** Coordinates of a fixed position: laid out after the "Fixed position" switch. */
const FIXED_FIELDS = (["lat", "lon", "alt"] as const).map((name) => ({
  field: scalar(name, "float"),
  path: `fixedPosition.${name}`,
}));

type Schema = {
  owner: FieldSchema[];
  config: Record<string, FieldSchema[]>;
  moduleConfig: Record<string, FieldSchema[]>;
};

function fieldsOf(schema: Schema | undefined, section: SectionMeta): FieldSchema[] {
  if (!schema) return [];
  if (section.kind === "owner") return schema.owner;
  if (section.kind === "config") return schema.config[section.key] ?? [];
  if (section.kind === "module") return schema.moduleConfig[section.key] ?? [];
  return [];
}

const pathOf = (section: SectionMeta, name: string) =>
  section.kind === "owner"
    ? `owner.${name}`
    : `${section.kind === "module" ? "moduleConfig" : "config"}.${section.key}.${name}`;

/** Nested messages (e.g. `ipv4Config`) as their own fields; deeper ones stay read-only. */
function flatten(fields: FieldSchema[], prefix: string): { field: FieldSchema; path: string }[] {
  return fields.flatMap((f) =>
    f.kind === "message" && !f.list && f.fields
      ? flatten(f.fields, `${prefix}.${f.name}`)
      : [{ field: f, path: `${prefix}.${f.name}` }],
  );
}

/** The static IP a pending network change gives the node (shown in the review, CR-002 §7.1). */
function staticHost(get: (path: string) => unknown): string | null {
  const ip = get("config.network.ipv4Config.ip");
  return get("config.network.addressMode") === "STATIC" && typeof ip === "number" && ip !== 0
    ? ipv4FromUint32(ip)
    : null;
}

function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "Couldn't reach MeshTerm. Try again.";
  if (err.code === "conflict")
    return "The node's settings changed meanwhile. Check the fields marked and apply again.";
  return err.message;
}

/** `/settings/device`: the node's settings by section, staged edits, review and apply (CR-002 §5). */
export function DeviceSettingsPage() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const nodeState = useLiveStore((s) => s.nodeState);
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const { section: sectionId } = useSearch({ from: "/settings/device" });
  const [advanced, setAdvanced] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const schema = useQuery({
    queryKey: queryKeys.configSchema,
    queryFn: api.configSchema,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const config = useQuery({
    queryKey: queryKeys.deviceConfig(connectionId ?? 0),
    queryFn: () => api.deviceConfig(connectionId ?? 0),
    enabled: connectionId !== null,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const apply = useQuery<ApplyStatusDTO | null>({
    queryKey: queryKeys.configApply(connectionId ?? 0),
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });
  const { data: mapNodes } = useMapNodes(connectionId);
  const { data: connections } = useConnections();
  const conn = connections?.find((c) => c.id === connectionId);

  const storeConn = useEditsStore((s) => s.connectionId);
  const storeEdits = useEditsStore((s) => s.edits);
  const edits = storeConn === connectionId ? storeEdits : NO_EDITS;
  const myApplyId = useEditsStore((s) => s.applyId);
  const { clear, setApplyId } = useEditsStore.getState();

  // The node's own position is where a fixed position starts from (CR-002 §5.6).
  const self = mapNodes?.features.find((f) => f.properties.isSelf);
  const selfLon = self?.geometry.coordinates[0];
  const selfLat = self?.geometry.coordinates[1];
  const cfg = useMemo<ConfigView | undefined>(
    () =>
      config.data && {
        ...config.data,
        fixedPosition:
          selfLat === undefined || selfLon === undefined ? null : { lat: selfLat, lon: selfLon },
      },
    [config.data, selfLat, selfLon],
  );
  const get = useMemo(() => getterFor(cfg, edits), [cfg, edits]);
  // A section per module the node reports, in protobuf order.
  const moduleKeys = useMemo(
    () =>
      Object.keys(schema.data?.moduleConfig ?? {}).filter((k) => k in (cfg?.moduleConfig ?? {})),
    [schema.data, cfg],
  );
  const sections = useMemo(() => allSections(moduleKeys), [moduleKeys]);
  const section = sectionById(sectionId, sections);
  const rebooting = useMemo(
    () => new Set(sections.filter((s) => s.reboots).map((s) => s.id)),
    [sections],
  );
  const summary = useMemo(() => summarize(cfg, edits, rebooting), [cfg, edits, rebooting]);

  const status = apply.data;
  const running = status !== null && !TERMINAL.has(status.phase);
  const showStatus = status !== null && status.applyId !== dismissed;
  const readOnly = !admin || running || nodeState !== "connected";
  const someoneElse = running && status.applyId !== myApplyId;

  const landed =
    status !== null &&
    status.applyId === myApplyId &&
    (status.phase === "verified" || status.phase === "mismatched");
  useEffect(() => {
    // The node has what it has now: the staged edits are done.
    if (landed) clear();
  }, [landed, clear]);

  async function doApply() {
    if (!cfg || connectionId === null) return;
    setBusy(true);
    try {
      const started = await api.applyConfig(connectionId, {
        baseVersion: cfg.version,
        changes: buildChanges(edits, cfg),
      });
      setApplyId(started.applyId);
      qc.setQueryData(queryKeys.configApply(connectionId), (prev: ApplyStatusDTO | null) =>
        prev?.applyId === started.applyId ? prev : started,
      );
      setReviewing(false);
    } catch (err) {
      toast(errorText(err), "error");
      if (err instanceof ApiError && err.code === "conflict") {
        await qc.invalidateQueries({ queryKey: queryKeys.deviceConfig(connectionId) });
      }
    } finally {
      setBusy(false);
    }
  }

  const fields = fieldsOf(schema.data, section);
  const visible = [
    ...flatten(fields, pathOf(section, "").slice(0, -1)),
    ...(section.id === "position" ? FIXED_FIELDS : []),
  ].filter(({ path }) => {
    const meta = metaFor(path);
    return !meta.hidden && (meta.visibleIf?.(get) ?? true);
  });
  const advancedCount = visible.filter(({ path }) => metaFor(path).advanced).length;
  const shown = visible.filter(({ path }) => advanced || !metaFor(path).advanced || path in edits);
  const groups = [...section.groups, "Other"]
    .map((g) => ({
      name: g,
      items: shown.filter(({ path }) => (metaFor(path).group ?? "Other") === g),
    }))
    .filter((g) => g.items.length > 0);

  const ctx: FieldContext | null = cfg
    ? { connectionId, cfg, edits, get, disabled: readOnly }
    : null;
  const ownerShort = typeof cfg?.owner?.shortName === "string" ? cfg.owner.shortName : "";
  const ownerLong = typeof cfg?.owner?.longName === "string" ? cfg.owner.longName : "";

  return (
    <section data-mt="config-view" data-mt-state={readOnly ? "read-only" : "editable"}>
      <header data-mt="config-header">
        <h2 data-mt="settings-title">Device settings</h2>
        <p data-mt="config-connection" data-mt-state={nodeState ?? "unknown"}>
          {ownerLong && <strong>{ownerLong}</strong>}
          {ownerShort && <span> ({ownerShort})</span>}
          {cfg?.firmware && <span> · fw {cfg.firmware}</span>}
          <span data-mt="config-connection-state"> · {nodeState ?? "…"}</span>
        </p>
      </header>

      {!admin && (
        <p data-mt="detail-note">
          You&apos;re a viewer: settings are read-only and secrets hidden.
        </p>
      )}
      {someoneElse && (
        <p data-mt="config-lock" role="status">
          Apply in progress by {status.by ?? "another user"}: editing is locked until it finishes.
        </p>
      )}
      {admin && nodeState !== "connected" && !running && (
        <p data-mt="config-lock" role="status">
          Editing needs the node connected.
        </p>
      )}
      {showStatus && (
        <ApplyProgress
          status={status}
          address={conn ? `${conn.host}:${conn.port}` : null}
          onDismiss={() => {
            setDismissed(status.applyId);
          }}
        />
      )}

      <div data-mt="config-layout">
        <nav data-mt="config-nav" aria-label="Device settings sections">
          {sections.map((s, i) => {
            const n = summary.bySection[s.id] ?? 0;
            const active = s.id === section.id;
            const firstModule = s.kind === "module" && sections[i - 1]?.kind !== "module";
            return [
              firstModule && (
                <span key="modules" data-mt="config-nav-heading">
                  Modules
                </span>
              ),
              <Link
                key={s.id}
                to="/settings/device"
                search={{ section: s.id }}
                data-mt="config-nav-item"
                data-mt-state={
                  [active && "active", n > 0 && "dirty"].filter(Boolean).join(" ") || undefined
                }
                data-mt-variant={s.danger ? "danger" : undefined}
                aria-current={active ? "page" : undefined}
              >
                <span data-mt="config-nav-title">{s.title}</span>
                <span data-mt="config-nav-summary">{s.summary}</span>
                {n > 0 && (
                  <span data-mt="config-nav-badge" aria-label={`${n} unsaved`}>
                    •{n}
                  </span>
                )}
              </Link>,
            ];
          })}
        </nav>

        <div data-mt="config-section" data-section={section.id} aria-label={section.title}>
          <h3 data-mt="settings-subtitle">{section.title}</h3>
          {schema.isError || config.isError ? (
            <p role="alert">
              {config.error instanceof ApiError && config.error.status === 404
                ? "The node hasn't reported its settings yet."
                : "Settings couldn't be loaded."}
            </p>
          ) : !ctx || !schema.data ? (
            <div data-mt="skeleton" aria-hidden />
          ) : section.kind === "channels" ? (
            <ChannelsEditor ctx={ctx} admin={admin} />
          ) : section.kind === "backup" || section.kind === "maintenance" ? (
            !admin ? (
              <p data-mt="detail-note">Only admins can back up, restore or maintain the node.</p>
            ) : section.kind === "backup" ? (
              <BackupRestore ctx={ctx} moduleKeys={moduleKeys} />
            ) : (
              <Maintenance connectionId={connectionId} shortName={ownerShort} disabled={readOnly} />
            )
          ) : (
            <>
              {groups.map((g) => (
                <fieldset key={g.name} data-mt="config-group">
                  {(groups.length > 1 || g.name !== section.title) && (
                    <legend data-mt="config-group-title">{g.name}</legend>
                  )}
                  {g.items.map(({ field, path }) => (
                    <ConfigField key={path} {...fieldProps(ctx, path, field, section.reboots)} />
                  ))}
                  {g.name === "Keys" && section.id === "security" && admin && (
                    <button
                      type="button"
                      data-mt="button"
                      disabled={readOnly}
                      onClick={() => {
                        void api.keyPair().then(
                          ({ privateKey, publicKey }) => {
                            stage(ctx, "config.security.privateKey", privateKey);
                            stage(ctx, "config.security.publicKey", publicKey);
                          },
                          () => {
                            toast("Couldn't make a key pair. Try again.", "error");
                          },
                        );
                      }}
                    >
                      New key pair…
                    </button>
                  )}
                  {g.name === "Fixed position" && get("config.position.fixedPosition") === true && (
                    <button
                      type="button"
                      data-mt="button"
                      disabled={readOnly}
                      onClick={() => {
                        setPicking(true);
                      }}
                    >
                      Pick on map…
                    </button>
                  )}
                </fieldset>
              ))}
              {advancedCount > 0 && (
                <button
                  type="button"
                  data-mt="button"
                  aria-expanded={advanced}
                  onClick={() => {
                    setAdvanced((a) => !a);
                  }}
                >
                  {advanced ? "Hide advanced" : `Show advanced (${advancedCount})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {admin && summary.count > 0 && (
        <div data-mt="pending-tray" role="region" aria-label="Pending changes">
          <p data-mt="pending-summary">
            {summary.count} pending {summary.count === 1 ? "change" : "changes"} in{" "}
            {Object.keys(summary.bySection).length}{" "}
            {Object.keys(summary.bySection).length === 1 ? "section" : "sections"}
            {summary.reboot && " · node will reboot"}
          </p>
          <div data-mt="pending-actions">
            <button type="button" data-mt="button" disabled={running} onClick={clear}>
              Discard all
            </button>
            <button
              type="button"
              data-mt="button"
              data-mt-variant="primary"
              disabled={readOnly}
              onClick={() => {
                setReviewing(true);
              }}
            >
              Review &amp; apply
            </button>
          </div>
        </div>
      )}

      {picking && ctx && (
        <Suspense fallback={null}>
          <MapPicker
            open={picking}
            onOpenChange={setPicking}
            initial={
              typeof get("fixedPosition.lat") === "number" &&
              typeof get("fixedPosition.lon") === "number"
                ? {
                    lat: get("fixedPosition.lat") as number,
                    lon: get("fixedPosition.lon") as number,
                  }
                : null
            }
            onPick={({ lat, lon }) => {
              stage(ctx, "fixedPosition.lat", lat);
              stage(ctx, "fixedPosition.lon", lon);
            }}
          />
        </Suspense>
      )}

      <ReviewDialog
        open={reviewing}
        onOpenChange={setReviewing}
        edits={edits}
        summary={summary}
        get={get}
        shortName={ownerShort}
        addresses={
          staticHost(get) && conn && staticHost(get) !== conn.host
            ? { current: conn.host, next: staticHost(get) ?? "" }
            : null
        }
        busy={busy || readOnly}
        onApply={() => void doApply()}
      />
    </section>
  );
}
