/**
 * UX details for device-config fields (CR-002 §6), keyed by full path
 * (`owner.longName`, `config.lora.hopLimit`). The field list itself comes from the
 * protobuf schema (`GET /api/config/schema`); fields without an entry still render,
 * with a humanized name, under "Advanced".
 */

/** The value of another field (pending edit if any, else the node's). */
export type Getter = (path: string) => unknown;

export interface FieldMeta {
  label: string;
  help?: string;
  /** Heading within the section. */
  group?: string;
  unit?: "s" | "ms" | "dBm" | "MHz" | "kHz" | "m" | "%" | "V" | "dB";
  min?: number;
  max?: number;
  step?: number;
  /** UTF-8 byte limit for strings. */
  maxBytes?: number;
  enumLabels?: Record<string, string>;
  /** Enum values not offered (deprecated or reserved). */
  hiddenValues?: string[];
  secret?: boolean;
  requiresReboot?: boolean;
  /** `lockout` changes need the node's short name typed to apply (CR-002 §7.1). */
  danger?: "warn" | "lockout";
  /** A warning for this value (shown inline and in the review); null when fine. */
  warning?: (value: unknown, get: Getter) => string | null;
  visibleIf?: (get: Getter) => boolean;
  validate?: (value: unknown, get: Getter) => string | null;
  advanced?: boolean;
  /** Shown but never editable (identity fields). */
  readOnly?: boolean;
  /** Not shown at all. */
  hidden?: boolean;
  /** A slider instead of a number box (needs min and max). */
  control?: "slider";
  /** What a value means, shown beside the input (e.g. a slider's radius). */
  valueText?: (value: unknown) => string;
}

export type SectionKind = "owner" | "config" | "module" | "channels";

export interface SectionMeta {
  /** URL id: `user`, `device`, `lora`, … */
  id: string;
  kind: SectionKind;
  /** The section's key in the config (`lora`); unused for the owner. */
  key: string;
  title: string;
  summary: string;
  /** Changing anything here reboots the node. */
  reboots: boolean;
  /** Network / Security / Maintenance: marked in the nav (CR-002 §5.1). */
  danger?: string;
  /** Groups in display order. */
  groups: string[];
}

/** Sections in this phase (D2); Channels, Network, Security, Modules, Backup and Maintenance follow. */
const USER: SectionMeta = {
  id: "user",
  kind: "owner",
  key: "owner",
  title: "User",
  summary: "Owner name, short name, licensed",
  reboots: false,
  groups: ["Identity"],
};

export const SECTIONS: SectionMeta[] = [
  USER,
  {
    id: "device",
    kind: "config",
    key: "device",
    title: "Device",
    summary: "Role, rebroadcast, intervals, time zone…",
    reboots: true,
    groups: ["Role", "Timing", "Hardware"],
  },
  {
    id: "lora",
    kind: "config",
    key: "lora",
    title: "LoRa",
    summary: "Region, preset, hop limit, TX power…",
    reboots: true,
    groups: ["Region", "Modem", "Transmit", "Filtering"],
  },
  {
    id: "channels",
    kind: "channels",
    key: "channels",
    title: "Channels",
    summary: "Names, keys, MQTT, position precision",
    reboots: false,
    groups: [],
  },
  {
    id: "position",
    kind: "config",
    key: "position",
    title: "Position",
    summary: "GPS, fixed position, broadcast…",
    reboots: false,
    groups: ["Broadcast", "Fixed position", "GPS"],
  },
  {
    id: "power",
    kind: "config",
    key: "power",
    title: "Power",
    summary: "Power saving, sleep, shutdown…",
    reboots: true,
    groups: ["Saving", "Sleep"],
  },
  {
    id: "display",
    kind: "config",
    key: "display",
    title: "Display",
    summary: "Screen, units, orientation…",
    reboots: false,
    groups: ["Screen", "Content"],
  },
  {
    id: "bluetooth",
    kind: "config",
    key: "bluetooth",
    title: "Bluetooth",
    summary: "Enabled, pairing mode, PIN",
    reboots: true,
    groups: ["Bluetooth"],
  },
];

/** The section with this URL id; User when there is none. */
export const sectionById = (id: string | undefined): SectionMeta =>
  SECTIONS.find((s) => s.id === id) ?? USER;

const utf8 = (s: string) => new TextEncoder().encode(s).length;
const ROUTER_ROLES = new Set(["ROUTER", "ROUTER_LATE", "REPEATER", "ROUTER_CLIENT"]);
const shortInterval = (min: number) => (v: unknown) =>
  typeof v === "number" && v > 0 && v < min
    ? `Below ${min / 60} min this uses noticeable airtime on a busy mesh.`
    : null;

export const FIELDS: Record<string, FieldMeta> = {
  // ------------------------------------------------------------------ owner
  "owner.longName": {
    label: "Long name",
    help: "Shown in node lists and messages. Your callsign in licensed mode.",
    group: "Identity",
    maxBytes: 39,
    validate: (v) => (typeof v === "string" && v.trim() === "" ? "A name is required." : null),
  },
  "owner.shortName": {
    label: "Short name",
    help: "Up to 4 characters, shown on small screens and map markers.",
    group: "Identity",
    maxBytes: 4,
    validate: (v) =>
      typeof v === "string" && v.trim() === "" ? "A short name is required." : null,
  },
  "owner.isLicensed": {
    label: "Licensed (ham) mode",
    help: "For licensed amateur radio operators: allows higher power where legal.",
    group: "Identity",
    danger: "warn",
    warning: (v) =>
      v === true
        ? "Encryption is turned off on every channel, and your long name should be your callsign."
        : null,
  },
  "owner.isUnmessagable": {
    label: "Can't receive messages",
    help: "Tell others this node doesn't take direct messages (e.g. an unattended router).",
    group: "Identity",
  },
  "owner.id": { label: "Node ID", group: "Identity", readOnly: true },
  "owner.hwModel": { label: "Hardware", group: "Identity", readOnly: true },
  "owner.role": { label: "Role", hidden: true }, // set in Device
  "owner.macaddr": { label: "MAC address", hidden: true },
  "owner.publicKey": { label: "Public key", hidden: true },

  // ----------------------------------------------------------------- device
  "config.device.role": {
    label: "Role",
    help: "How the node behaves on the mesh. Client suits almost everyone.",
    group: "Role",
    enumLabels: {
      CLIENT: "Client",
      CLIENT_MUTE: "Client (mute: never rebroadcasts)",
      CLIENT_HIDDEN: "Client (hidden)",
      CLIENT_BASE: "Client base",
      ROUTER: "Router",
      ROUTER_LATE: "Router (late)",
      ROUTER_CLIENT: "Router + client (deprecated)",
      REPEATER: "Repeater (deprecated)",
      TRACKER: "Tracker",
      SENSOR: "Sensor",
      TAK: "TAK",
      TAK_TRACKER: "TAK tracker",
      LOST_AND_FOUND: "Lost and found",
    },
    hiddenValues: ["ROUTER_CLIENT", "REPEATER"],
    danger: "warn",
    warning: (v) =>
      typeof v === "string" && ROUTER_ROLES.has(v)
        ? "Router roles are for well-placed infrastructure nodes; on a poorly placed node they harm the mesh."
        : null,
  },
  "config.device.rebroadcastMode": {
    label: "Rebroadcast",
    help: "Which packets this node relays for others.",
    group: "Role",
    enumLabels: {
      ALL: "All",
      ALL_SKIP_DECODING: "All, without decoding",
      LOCAL_ONLY: "Only my channels",
      KNOWN_ONLY: "Only known nodes",
      NONE: "None",
      CORE_PORTNUMS_ONLY: "Core messages only",
    },
  },
  "config.device.nodeInfoBroadcastSecs": {
    label: "Node info broadcast",
    help: "How often the node announces its name and key.",
    group: "Timing",
    unit: "s",
    min: 0,
    warning: shortInterval(3600),
  },
  "config.device.tzdef": {
    label: "Time zone",
    help: "POSIX TZ string, e.g. EST5EDT,M3.2.0,M11.1.0. Empty: UTC.",
    group: "Timing",
    maxBytes: 64,
  },
  "config.device.isManaged": {
    label: "Managed mode",
    help: "Only an admin key may change the config.",
    group: "Role",
    danger: "lockout",
    warning: (v) =>
      v === true
        ? "The node will refuse local config changes except from an admin key: MeshTerm won't be able to edit it any more."
        : null,
  },
  "config.device.serialEnabled": { label: "Serial console", group: "Hardware", advanced: true },
  "config.device.buttonGpio": { label: "Button GPIO", group: "Hardware", advanced: true },
  "config.device.buzzerGpio": { label: "Buzzer GPIO", group: "Hardware", advanced: true },
  "config.device.buzzerMode": {
    label: "Buzzer",
    group: "Hardware",
    enumLabels: {
      ALL_ENABLED: "All sounds",
      DISABLED: "Off",
      NOTIFICATIONS_ONLY: "Notifications only",
      SYSTEM_ONLY: "System sounds only",
      DIRECT_MSG_ONLY: "Direct messages only",
    },
  },
  "config.device.doubleTapAsButtonPress": { label: "Double tap = button", group: "Hardware" },
  "config.device.disableTripleClick": { label: "Disable triple click", group: "Hardware" },
  "config.device.ledHeartbeatDisabled": { label: "Disable heartbeat LED", group: "Hardware" },

  // ------------------------------------------------------------------- LoRa
  "config.lora.region": {
    label: "Region",
    help: "Sets the legal frequencies and power. Must match where the node is used.",
    group: "Region",
    requiresReboot: true,
    danger: "warn",
    warning: (v) =>
      v === "UNSET"
        ? "The node can't transmit until a region is set."
        : "Changing the region changes the frequencies the node uses; only pick the one you're in.",
    validate: (v) => (v === "UNSET" ? "Set the region." : null),
  },
  "config.lora.usePreset": {
    label: "Use a modem preset",
    help: "Presets keep you compatible with other nodes. Custom settings are for experts.",
    group: "Modem",
  },
  "config.lora.modemPreset": {
    label: "Preset",
    group: "Modem",
    visibleIf: (get) => get("config.lora.usePreset") !== false,
    enumLabels: {
      LONG_FAST: "Long range, fast (default)",
      LONG_SLOW: "Long range, slow",
      LONG_MODERATE: "Long range, moderate",
      LONG_TURBO: "Long range, turbo",
      VERY_LONG_SLOW: "Very long range, slow",
      MEDIUM_SLOW: "Medium range, slow",
      MEDIUM_FAST: "Medium range, fast",
      MEDIUM_TURBO: "Medium range, turbo",
      SHORT_SLOW: "Short range, slow",
      SHORT_FAST: "Short range, fast",
      SHORT_TURBO: "Short range, turbo",
    },
    warning: () => "Every node you talk to must use the same preset.",
  },
  "config.lora.bandwidth": {
    label: "Bandwidth",
    group: "Modem",
    unit: "kHz",
    visibleIf: (get) => get("config.lora.usePreset") === false,
  },
  "config.lora.spreadFactor": {
    label: "Spreading factor",
    group: "Modem",
    min: 7,
    max: 12,
    visibleIf: (get) => get("config.lora.usePreset") === false,
  },
  "config.lora.codingRate": {
    label: "Coding rate (4/x)",
    group: "Modem",
    min: 5,
    max: 8,
    visibleIf: (get) => get("config.lora.usePreset") === false,
  },
  "config.lora.channelNum": {
    label: "Frequency slot",
    help: "0 picks the slot from the primary channel's name.",
    group: "Modem",
    min: 0,
    advanced: true,
  },
  "config.lora.frequencyOffset": {
    label: "Frequency offset",
    group: "Modem",
    unit: "MHz",
    advanced: true,
  },
  "config.lora.overrideFrequency": {
    label: "Override frequency",
    help: "0: use the region and slot.",
    group: "Modem",
    unit: "MHz",
    advanced: true,
  },
  "config.lora.hopLimit": {
    label: "Hop limit",
    help: "How many times others relay your packets. 3 is the default.",
    group: "Transmit",
    min: 0,
    max: 7,
    danger: "warn",
    warning: (v) =>
      typeof v === "number" && v > 3 ? "More than 3 hops costs everyone airtime." : null,
  },
  "config.lora.txEnabled": {
    label: "Transmit",
    group: "Transmit",
    danger: "warn",
    warning: (v) => (v === false ? "The node will stop transmitting entirely." : null),
  },
  "config.lora.txPower": {
    label: "TX power",
    help: "0 uses the region's default (usually its legal maximum).",
    group: "Transmit",
    unit: "dBm",
    min: 0,
    max: 30,
    danger: "warn",
    warning: (v) =>
      typeof v === "number" && v > 0
        ? "Check your region's legal limit before raising this."
        : null,
  },
  "config.lora.overrideDutyCycle": {
    label: "Override duty cycle",
    group: "Transmit",
    danger: "warn",
    warning: (v) =>
      v === true ? "Duty-cycle limits are regulations in some regions (e.g. EU)." : null,
  },
  "config.lora.sx126xRxBoostedGain": {
    label: "RX boosted gain (SX126x)",
    group: "Transmit",
    advanced: true,
  },
  "config.lora.paFanDisabled": { label: "Disable PA fan", group: "Transmit", advanced: true },
  "config.lora.femLnaMode": { label: "FEM LNA", group: "Transmit", advanced: true },
  "config.lora.ignoreIncoming": {
    label: "Ignore nodes",
    help: "Node numbers whose packets are dropped.",
    group: "Filtering",
    advanced: true,
  },
  "config.lora.ignoreMqtt": { label: "Ignore packets from MQTT", group: "Filtering" },
  "config.lora.configOkToMqtt": {
    label: "OK to upload to MQTT",
    help: "Lets gateways forward your packets to MQTT servers.",
    group: "Filtering",
  },
  "config.lora.serialHalOnly": { label: "Serial HAL only", group: "Filtering", advanced: true },

  // --------------------------------------------------------------- position
  "config.position.positionBroadcastSecs": {
    label: "Position broadcast",
    help: "How often the node broadcasts its position.",
    group: "Broadcast",
    unit: "s",
    min: 0,
    warning: shortInterval(300),
  },
  "config.position.positionBroadcastSmartEnabled": {
    label: "Smart broadcast",
    help: "Broadcast sooner when the node has moved.",
    group: "Broadcast",
  },
  "config.position.broadcastSmartMinimumDistance": {
    label: "Smart: minimum distance",
    group: "Broadcast",
    unit: "m",
    visibleIf: (get) => get("config.position.positionBroadcastSmartEnabled") === true,
  },
  "config.position.broadcastSmartMinimumIntervalSecs": {
    label: "Smart: minimum interval",
    group: "Broadcast",
    unit: "s",
    visibleIf: (get) => get("config.position.positionBroadcastSmartEnabled") === true,
  },
  "config.position.fixedPosition": {
    label: "Fixed position",
    help: "Use a set position instead of GPS.",
    group: "Fixed position",
    warning: (v) =>
      v === true
        ? "The position is broadcast with each channel's position precision (see Channels)."
        : null,
  },
  "config.position.gpsMode": {
    label: "GPS",
    group: "GPS",
    enumLabels: { DISABLED: "Off", ENABLED: "On", NOT_PRESENT: "No GPS fitted" },
  },
  "config.position.gpsUpdateInterval": { label: "GPS update interval", group: "GPS", unit: "s" },
  "config.position.gpsAttemptTime": {
    label: "GPS attempt time",
    group: "GPS",
    unit: "s",
    advanced: true,
  },
  "config.position.positionFlags": {
    label: "Position fields",
    help: "Bit flags for what a position packet includes.",
    group: "Broadcast",
    advanced: true,
  },
  "config.position.gpsEnabled": { label: "GPS enabled (deprecated)", hidden: true },
  "config.position.rxGpio": { label: "GPS RX GPIO", group: "GPS", advanced: true },
  "config.position.txGpio": { label: "GPS TX GPIO", group: "GPS", advanced: true },
  "config.position.gpsEnGpio": { label: "GPS enable GPIO", group: "GPS", advanced: true },

  // ------------------------------------------------------------------ power
  "config.power.isPowerSaving": {
    label: "Power saving",
    help: "Sleep the radio and CPU when possible (mainly for routers and sensors on battery).",
    group: "Saving",
  },
  "config.power.onBatteryShutdownAfterSecs": {
    label: "Shut down on battery after",
    help: "0: never.",
    group: "Saving",
    unit: "s",
  },
  "config.power.adcMultiplierOverride": {
    label: "ADC multiplier",
    help: "Battery voltage calibration; 0 uses the board default.",
    group: "Saving",
    advanced: true,
  },
  "config.power.waitBluetoothSecs": {
    label: "Bluetooth wait",
    group: "Sleep",
    unit: "s",
    advanced: true,
  },
  "config.power.sdsSecs": {
    label: "Super deep sleep after",
    group: "Sleep",
    unit: "s",
    advanced: true,
  },
  "config.power.lsSecs": {
    label: "Light sleep duration",
    group: "Sleep",
    unit: "s",
    advanced: true,
  },
  "config.power.minWakeSecs": {
    label: "Minimum wake time",
    group: "Sleep",
    unit: "s",
    advanced: true,
  },
  "config.power.deviceBatteryInaAddress": {
    label: "Battery INA address",
    group: "Saving",
    advanced: true,
  },
  "config.power.powermonEnables": { label: "Power monitor flags", group: "Saving", advanced: true },

  // ---------------------------------------------------------------- display
  "config.display.screenOnSecs": {
    label: "Screen timeout",
    help: "0 uses the default.",
    group: "Screen",
    unit: "s",
  },
  "config.display.autoScreenCarouselSecs": {
    label: "Carousel interval",
    help: "Cycle through screens every this many seconds; 0 turns it off.",
    group: "Screen",
    unit: "s",
  },
  "config.display.flipScreen": { label: "Flip screen", group: "Screen" },
  "config.display.oled": {
    label: "OLED type",
    group: "Screen",
    advanced: true,
    enumLabels: { OLED_AUTO: "Detect" },
  },
  "config.display.displaymode": {
    label: "Display mode",
    group: "Screen",
    enumLabels: {
      DEFAULT: "Default",
      TWOCOLOR: "Two-colour",
      INVERTED: "Inverted",
      COLOR: "Colour",
    },
  },
  "config.display.compassOrientation": {
    label: "Compass orientation",
    group: "Screen",
    advanced: true,
  },
  "config.display.wakeOnTapOrMotion": { label: "Wake on tap or motion", group: "Screen" },
  "config.display.units": {
    label: "Units",
    group: "Content",
    enumLabels: { METRIC: "Metric", IMPERIAL: "Imperial" },
  },
  "config.display.use12hClock": { label: "12-hour clock", group: "Content" },
  "config.display.compassNorthTop": { label: "Compass: north up", group: "Content" },
  "config.display.headingBold": { label: "Bold headings", group: "Content" },
  "config.display.useLongNodeName": { label: "Long node names", group: "Content" },
  "config.display.enableMessageBubbles": { label: "Message bubbles", group: "Content" },
  "config.display.gpsFormat": { label: "GPS format", hidden: true },

  // -------------------------------------------------------------- bluetooth
  "config.bluetooth.enabled": {
    label: "Bluetooth",
    group: "Bluetooth",
    danger: "warn",
    warning: (v) =>
      v === false
        ? "The phone app can't connect over Bluetooth any more: keep another way in (Wi-Fi or USB)."
        : null,
  },
  "config.bluetooth.mode": {
    label: "Pairing",
    group: "Bluetooth",
    enumLabels: {
      RANDOM_PIN: "Random PIN (shown on screen)",
      FIXED_PIN: "Fixed PIN",
      NO_PIN: "No PIN",
    },
    visibleIf: (get) => get("config.bluetooth.enabled") !== false,
    warning: (v) => (v === "NO_PIN" ? "Anyone nearby can pair with the node." : null),
  },
  "config.bluetooth.fixedPin": {
    label: "PIN",
    help: "Six digits.",
    group: "Bluetooth",
    min: 100_000,
    max: 999_999,
    visibleIf: (get) =>
      get("config.bluetooth.enabled") !== false && get("config.bluetooth.mode") === "FIXED_PIN",
  },
};

/** The default channel key ("AQ==": the public, well-known key). */
export const DEFAULT_PSK = "AQ==";

/** Bytes of a base64 key, or null when it isn't base64. */
export function pskBytes(psk: string): number | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(psk) || psk.length % 4 !== 0) return null;
  return (psk.length / 4) * 3 - (psk.endsWith("==") ? 2 : psk.endsWith("=") ? 1 : 0);
}

/**
 * Roughly how far a broadcast position can be from the real one at this precision
 * (bits kept of the 32-bit coordinates; 0 = no position, 32 = exact).
 */
export function precisionRadius(bits: number): string {
  if (bits <= 0) return "No position shared";
  if (bits >= 32) return "Exact position";
  const metres = (2 ** (32 - bits) * 1e-7 * 111_320) / 2;
  return metres >= 1000 ? `~${(metres / 1000).toFixed(1)} km` : `~${Math.round(metres)} m`;
}

/** Channel fields, by `channels.*.<path>` (the editor's own form, CR-002 §5.4). */
const CHANNEL_FIELDS: Record<string, FieldMeta> = {
  "channels.*.role": {
    label: "Role",
    enumLabels: { PRIMARY: "Primary", SECONDARY: "Secondary", DISABLED: "Disabled" },
    readOnly: true,
  },
  "channels.*.settings.name": {
    label: "Name",
    help: "Up to 11 characters. Empty on the primary: the preset name (e.g. LongFast).",
    maxBytes: 11,
  },
  "channels.*.settings.psk": {
    label: "Key",
    secret: true,
    danger: "warn",
    warning: (v) =>
      v === ""
        ? "No key: the channel is unencrypted, anyone can read it."
        : v === DEFAULT_PSK
          ? "The default key is public: anyone with a Meshtastic app can read this channel."
          : null,
    validate: (v) => {
      if (typeof v !== "string") return null;
      const n = pskBytes(v);
      if (n === null) return "Not base64.";
      return [0, 1, 16, 32].includes(n) ? null : `A key is 16 or 32 bytes (this one is ${n}).`;
    },
  },
  "channels.*.settings.uplinkEnabled": {
    label: "MQTT uplink",
    help: "Gateways may forward this channel's messages to MQTT.",
  },
  "channels.*.settings.downlinkEnabled": {
    label: "MQTT downlink",
    help: "Gateways may bring messages from MQTT into this channel.",
  },
  "channels.*.settings.moduleSettings.positionPrecision": {
    label: "Position precision",
    help: "How exactly your position is shared on this channel.",
    min: 0,
    max: 32,
    control: "slider",
    valueText: (v) => (typeof v === "number" ? precisionRadius(v) : ""),
  },
  "channels.*.settings.moduleSettings.isMuted": {
    label: "Muted",
    help: "No notifications on the node for this channel.",
  },
};

/** Fixed position coordinates (`set_fixed_position`, CR-002 §5.6). */
const POSITION_FIELDS: Record<string, FieldMeta> = {
  "fixedPosition.lat": {
    label: "Latitude",
    group: "Fixed position",
    visibleIf: (get) => get("config.position.fixedPosition") === true,
    min: -90,
    max: 90,
    step: 0.000001,
    validate: (v, get) =>
      get("config.position.fixedPosition") === true && typeof v !== "number"
        ? "Enter the latitude."
        : null,
  },
  "fixedPosition.lon": {
    label: "Longitude",
    group: "Fixed position",
    visibleIf: (get) => get("config.position.fixedPosition") === true,
    min: -180,
    max: 180,
    step: 0.000001,
    validate: (v, get) =>
      get("config.position.fixedPosition") === true && typeof v !== "number"
        ? "Enter the longitude."
        : null,
  },
  "fixedPosition.alt": {
    label: "Altitude",
    group: "Fixed position",
    visibleIf: (get) => get("config.position.fixedPosition") === true,
    unit: "m",
    min: -1000,
    max: 10_000,
    step: 1,
  },
};

/** "nodeInfoBroadcastSecs" → "Node info broadcast secs", for fields without an entry. */
export function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function metaFor(path: string): FieldMeta {
  if (path.startsWith("channels.")) {
    const meta = CHANNEL_FIELDS[path.replace(/^channels\.\d+\./, "channels.*.")];
    if (meta) return meta;
  }
  return (
    FIELDS[path] ??
    POSITION_FIELDS[path] ?? { label: humanize(path.split(".").at(-1) ?? path), advanced: true }
  );
}

/** Problems with a value: the field's own rules (range, bytes) and its `validate`. */
export function validateField(path: string, value: unknown, get: Getter): string | null {
  const meta = metaFor(path);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Enter a number.";
    if (meta.min !== undefined && value < meta.min) return `At least ${meta.min}.`;
    if (meta.max !== undefined && value > meta.max) return `At most ${meta.max}.`;
  }
  if (typeof value === "string" && meta.maxBytes !== undefined && utf8(value) > meta.maxBytes) {
    return `At most ${meta.maxBytes} bytes (${utf8(value)} now).`;
  }
  return meta.validate?.(value, get) ?? null;
}

export const sectionOf = (path: string): string => {
  const [kind, key] = path.split(".");
  if (kind === "owner") return "user";
  if (kind === "channels") return "channels";
  if (kind === "fixedPosition") return "position";
  return key ?? "";
};

/** Channel index of a `channels.<i>.…` path, else null. */
export function channelIndexOf(path: string): number | null {
  const m = /^channels\.(\d+)\./.exec(path);
  return m ? Number(m[1]) : null;
}
