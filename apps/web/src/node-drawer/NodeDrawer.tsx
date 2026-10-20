import { nodeIdFromNum, nodeNumFromId, type NodeDetailDTO } from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { Ellipsis, MapPin, MessageSquare, Star, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
import { STATUS_LABELS } from "../dashboard/insights.js";
import { hardwareLabel, roleLabel } from "../dashboard/labels.js";
import { useToggleFavorite } from "../dashboard/useFavorite.js";
import { nodeStatus } from "../dashboard/view.js";
import { useNodeDetail } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { registerNodeDrawer, useUiStore } from "../data/ui-store.js";
import { useThresholds } from "../messages/useNodeMap.js";
import { OverviewTab } from "./OverviewTab.js";
import { CopyButton, ICON, useCopy } from "./parts.js";
import { RawTab } from "./RawTab.js";
import { clampWidth, DRAWER_WIDTH, readDrawerWidth, writeDrawerWidth } from "./width.js";

// Charts load only when their tab is opened (the uPlot chunk in Phase C3).
const TelemetryTab = lazy(() =>
  import("./HistoryTabs.js").then((m) => ({ default: m.TelemetryTab })),
);
const SignalTab = lazy(() => import("./HistoryTabs.js").then((m) => ({ default: m.SignalTab })));

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "telemetry", label: "Telemetry" },
  { id: "signal", label: "Signal" },
  { id: "raw", label: "Raw" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function hopsText(hops: number | null): string | null {
  if (hops === null) return null;
  return hops === 0 ? "heard directly" : hops === 1 ? "1 hop" : `${hops} hops`;
}

/** The URL with `?node=` set to this node, for "Copy link". */
function linkTo(num: number): string {
  const url = new URL(window.location.href);
  url.searchParams.set("node", nodeIdFromNum(num));
  return url.toString();
}

function Header({
  connectionId,
  node,
  onClose,
}: {
  connectionId: number;
  node: NodeDetailDTO;
  onClose: () => void;
}) {
  const now = useNow();
  const thresholds = useThresholds(connectionId);
  const toggleFavorite = useToggleFavorite(connectionId);
  const navigate = useNavigate();
  const copy = useCopy();
  const status = nodeStatus(node.lastHeard, now, thresholds);
  const id = nodeIdFromNum(node.num);
  const name = node.longName || node.shortName || id;
  const kind = [
    node.role === null ? null : roleLabel(node.role),
    node.hwModel === null ? null : hardwareLabel(node.hwModel),
  ].filter(Boolean);
  const seen = [
    node.lastHeard === null
      ? "Never heard"
      : `Seen ${formatAgo(node.lastHeard, Math.max(now, node.lastHeard))}`,
    node.isSelf ? "My node" : hopsText(node.hopsAway),
    node.firmware ? `fw ${node.firmware}` : null,
  ].filter(Boolean);

  return (
    <header data-mt="node-drawer-header">
      <span data-mt="status-dot" data-mt-state={status} title={STATUS_LABELS[status]} />
      <div data-mt="node-drawer-names">
        <div data-mt="node-drawer-title-row">
          {node.shortName && <span data-mt="node-drawer-short">{node.shortName}</span>}
          <Dialog.Title data-mt="node-drawer-title">{name}</Dialog.Title>
        </div>
        <Dialog.Description data-mt="node-drawer-subtitle">
          {kind.length > 0 && <span>{kind.join(" · ")} · </span>}
          <CopyButton value={id} label="Copy node ID">
            {id}
          </CopyButton>
        </Dialog.Description>
        <p data-mt="node-drawer-seen">
          {STATUS_LABELS[status]} · {seen.join(" · ")}
        </p>
      </div>
      <button
        type="button"
        data-mt="favorite-toggle"
        data-mt-state={node.isFavorite ? "on" : "off"}
        aria-pressed={node.isFavorite}
        aria-label={node.isFavorite ? `Unfavorite ${name}` : `Favorite ${name}`}
        onClick={() => {
          void toggleFavorite(node.num, !node.isFavorite);
        }}
      >
        <Star data-mt="icon" {...ICON} />
      </button>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button type="button" data-mt="icon-button" aria-label="More actions">
            <Ellipsis data-mt="icon" {...ICON} />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content data-mt="node-drawer-menu" align="end" sideOffset={4}>
            <Menu.Item
              data-mt="menu-item"
              onSelect={() => {
                copy(id);
              }}
            >
              Copy node ID
            </Menu.Item>
            <Menu.Item
              data-mt="menu-item"
              onSelect={() => {
                copy(linkTo(node.num), "a link to this node");
              }}
            >
              Copy link to this node
            </Menu.Item>
            {node.position && (
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  void navigate({ to: "/map", search: { focus: id } });
                }}
              >
                Show on map
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <button type="button" data-mt="icon-button" aria-label="Close details" onClick={onClose}>
        <X data-mt="icon" {...ICON} />
      </button>
    </header>
  );
}

function Tabs({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  const base = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to =
      event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : step ? i + step : -1;
    if (to < 0 && step === 0) return;
    event.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    if (!next) return;
    onChange(next.id);
    document.getElementById(`${base}-${next.id}`)?.focus();
  };
  return (
    <div data-mt="node-drawer-tabs" role="tablist" aria-label="Node details" onKeyDown={onKeyDown}>
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`${base}-${t.id}`}
          type="button"
          role="tab"
          data-mt="node-drawer-tab"
          data-mt-variant={t.id}
          data-mt-state={t.id === tab ? "active" : "inactive"}
          aria-selected={t.id === tab}
          tabIndex={t.id === tab ? 0 : -1}
          onClick={() => {
            onChange(t.id);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Actions({ node }: { node: NodeDetailDTO }) {
  const id = nodeIdFromNum(node.num);
  if (node.isSelf && !node.position) return null;
  return (
    <footer data-mt="node-drawer-actions">
      {!node.isSelf && (
        <Link
          to="/messages/dm/$nodeId"
          params={{ nodeId: id }}
          data-mt="button"
          data-mt-variant="message"
        >
          <MessageSquare data-mt="icon" {...ICON} />
          Message
        </Link>
      )}
      {node.position && (
        <Link to="/map" search={{ focus: id }} data-mt="button" data-mt-variant="show-on-map">
          <MapPin data-mt="icon" {...ICON} />
          Show on map
        </Link>
      )}
    </footer>
  );
}

/** Drag or arrow keys on the drawer's inner edge; the width is remembered. */
function ResizeHandle({ width, onWidth }: { width: number; onWidth: (px: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The drawer is on the right: dragging left widens it.
    onWidth(clampWidth(drag.current.width + drag.current.x - e.clientX));
  };
  const onPointerUp = () => {
    if (drag.current) writeDrawerWidth(width);
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === "ArrowLeft" ? DRAWER_WIDTH.step : e.key === "ArrowRight" ? -DRAWER_WIDTH.step : 0;
    if (!delta) return;
    e.preventDefault();
    const next = clampWidth(width + delta);
    onWidth(next);
    writeDrawerWidth(next);
  };
  return (
    <div
      data-mt="node-drawer-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details"
      aria-valuemin={DRAWER_WIDTH.min}
      aria-valuemax={DRAWER_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}

function Body({
  connectionId,
  num,
  onClose,
}: {
  connectionId: number;
  num: number;
  onClose: () => void;
}) {
  const { data: node, isPending, isError } = useNodeDetail(connectionId, num);
  const [tab, setTab] = useState<TabId>("overview");
  const panelId = useId();

  if (isPending || isError) {
    return (
      <>
        <header data-mt="node-drawer-header">
          <div data-mt="node-drawer-names">
            <Dialog.Title data-mt="node-drawer-title">
              {isError ? "Unknown node" : nodeIdFromNum(num)}
            </Dialog.Title>
            <Dialog.Description data-mt="node-drawer-subtitle">
              {isError ? `MeshTerm hasn't heard ${nodeIdFromNum(num)}.` : "Loading…"}
            </Dialog.Description>
          </div>
          <button type="button" data-mt="icon-button" aria-label="Close details" onClick={onClose}>
            <X data-mt="icon" {...ICON} />
          </button>
        </header>
        {isPending && <div data-mt="skeleton" data-mt-variant="drawer" aria-hidden />}
      </>
    );
  }

  return (
    <>
      <Header connectionId={connectionId} node={node} onClose={onClose} />
      <Tabs tab={tab} onChange={setTab} />
      <div data-mt="node-drawer-body" role="tabpanel" id={panelId} aria-label={tab}>
        {tab === "overview" && <OverviewTab connectionId={connectionId} node={node} />}
        <Suspense fallback={<div data-mt="skeleton" data-mt-variant="chart" aria-hidden />}>
          {tab === "telemetry" && <TelemetryTab connectionId={connectionId} node={node} />}
          {tab === "signal" && <SignalTab connectionId={connectionId} node={node} />}
        </Suspense>
        {tab === "raw" && <RawTab node={node} />}
      </div>
      <Actions node={node} />
    </>
  );
}

/**
 * The node detail drawer (CR-001), mounted once in the shell. It lives in the URL:
 * `?node=!a1b2c3d4` on any route opens it over that view, so Back closes it and the
 * view underneath (and its scroll position) never changes.
 */
export function NodeDrawer() {
  const search: { node?: string } = useSearch({ strict: false });
  const num = search.node ? nodeNumFromId(search.node) : null;
  const connectionId = useLiveStore((s) => s.connectionId);
  const navigate = useNavigate();
  const router = useRouter();
  const [width, setWidth] = useState(() => readDrawerWidth());
  /** We added the history entry, so closing goes Back (a deep link replaces instead). */
  const pushed = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const current = useRef(num);

  useEffect(() => {
    registerNodeDrawer({
      open: (n) => {
        trigger.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const replace = current.current !== null;
        if (!replace) pushed.current = true;
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({ ...prev, node: nodeIdFromNum(n) }),
          replace,
        });
      },
      close: () => {
        if (current.current === null) return;
        if (pushed.current) {
          pushed.current = false;
          router.history.back();
          return;
        }
        void navigate({
          to: ".",
          search: ({ node: _node, ...rest }: Record<string, unknown>) => rest,
          replace: true,
        });
      },
    });
    return () => {
      registerNodeDrawer(null);
    };
  }, [navigate, router]);

  // The URL is the truth: Back, links and deep links all land here.
  useEffect(() => {
    current.current = num;
    if (num === null) pushed.current = false;
    if (useUiStore.getState().selectedNode !== num) useUiStore.setState({ selectedNode: num });
  }, [num]);

  const close = () => {
    useUiStore.getState().closeNode();
  };
  const open = num !== null && connectionId !== null;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="node-drawer"
          data-node-num={num ?? undefined}
          style={width === null ? undefined : { "--mt-node-drawer-width": `${width}px` }}
          onCloseAutoFocus={(e) => {
            // Back to whatever opened it (a card, a row, a map popup).
            if (trigger.current?.isConnected) {
              e.preventDefault();
              trigger.current.focus();
            }
          }}
        >
          <ResizeHandle width={width ?? DRAWER_WIDTH.default} onWidth={setWidth} />
          {open && <Body key={num} connectionId={connectionId} num={num} onClose={close} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
