import { ipv4FromUint32 } from "@meshterm/shared";
import type { FieldMeta, Getter } from "./registry.js";

/**
 * Network, Security and module fields (CR-002 Phase D4). Network and security changes
 * that can cut MeshTerm off are lockout-class (§7.1): the review asks for the short name.
 */

const changed = (text: string) => () => text;

const NETWORK_CUT =
  "MeshTerm talks to the node over the network: this can cut the connection. Have another way in (Bluetooth, USB).";

const ipv4: FieldMeta["validate"] = (v) =>
  typeof v === "number" ? null : "Not an IPv4 address (e.g. 192.168.1.20).";

const ipv4Field = (label: string, help?: string): FieldMeta => ({
  label,
  ...(help ? { help } : {}),
  group: "Static address",
  control: "ipv4",
  format: (v) => (typeof v === "number" ? (v === 0 ? "—" : ipv4FromUint32(v)) : String(v)),
  validate: ipv4,
  visibleIf: (get: Getter) => get("config.network.addressMode") === "STATIC",
});

export const NETWORK_FIELDS: Record<string, FieldMeta> = {
  "config.network.wifiEnabled": {
    label: "Wi-Fi",
    group: "Wi-Fi",
    danger: "lockout",
    warning: (v) => (v === false ? `Turns Wi-Fi off. ${NETWORK_CUT}` : null),
  },
  "config.network.wifiSsid": {
    label: "Network name (SSID)",
    group: "Wi-Fi",
    maxBytes: 32,
    danger: "lockout",
    warning: changed(`The node joins another Wi-Fi network. ${NETWORK_CUT}`),
    visibleIf: (get) => get("config.network.wifiEnabled") !== false,
  },
  "config.network.wifiPsk": {
    label: "Wi-Fi password",
    group: "Wi-Fi",
    secret: true,
    maxBytes: 64,
    danger: "lockout",
    warning: changed(`A wrong password keeps the node off the network. ${NETWORK_CUT}`),
    visibleIf: (get) => get("config.network.wifiEnabled") !== false,
  },
  "config.network.ethEnabled": {
    label: "Ethernet",
    group: "Ethernet",
    danger: "lockout",
    warning: (v) => (v === false ? `Turns Ethernet off. ${NETWORK_CUT}` : null),
  },
  "config.network.addressMode": {
    label: "Address",
    group: "Static address",
    enumLabels: { DHCP: "Automatic (DHCP)", STATIC: "Static" },
    danger: "lockout",
    warning: changed(`The node's IP address changes. ${NETWORK_CUT}`),
  },
  "config.network.ipv4Config.ip": {
    ...ipv4Field("IP address", "MeshTerm also tries this address after the reboot."),
    danger: "lockout",
    warning: changed(`The node moves to this address. ${NETWORK_CUT}`),
  },
  "config.network.ipv4Config.gateway": ipv4Field("Gateway"),
  "config.network.ipv4Config.subnet": ipv4Field("Subnet mask", "e.g. 255.255.255.0"),
  "config.network.ipv4Config.dns": ipv4Field("DNS server"),
  "config.network.ntpServer": { label: "NTP server", group: "Services", maxBytes: 32 },
  "config.network.rsyslogServer": { label: "Syslog server", group: "Services", advanced: true },
  "config.network.enabledProtocols": {
    label: "Network protocols",
    help: "Bit flags (1: UDP broadcast of mesh packets).",
    group: "Services",
    advanced: true,
  },
  "config.network.ipv6Enabled": { label: "IPv6", group: "Services", advanced: true },
};

const keyList: FieldMeta["validate"] = (v) => {
  if (!Array.isArray(v)) return null;
  if (v.length > 3) return "At most 3 admin keys.";
  const bad = (v as unknown[]).some(
    (k) => typeof k !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(k),
  );
  return bad ? "Each key is 32 bytes of base64 (44 characters)." : null;
};

export const SECURITY_FIELDS: Record<string, FieldMeta> = {
  "config.security.publicKey": {
    label: "Public key",
    help: "Others use it to send this node encrypted direct messages.",
    group: "Keys",
    readOnly: true,
    format: (v) => (typeof v === "string" && v !== "" ? v : "—"),
  },
  "config.security.privateKey": {
    label: "Private key",
    group: "Keys",
    secret: true,
    readOnly: true,
    danger: "lockout",
    warning: changed(
      "A new key pair breaks direct messages and admin trust with other nodes until they learn the new public key.",
    ),
  },
  "config.security.adminKey": {
    label: "Admin keys",
    help: "Public keys (base64, one per line, up to 3) allowed to administer this node remotely.",
    group: "Remote admin",
    control: "lines",
    validate: keyList,
    danger: "warn",
    warning: changed("Whoever holds these keys can change this node's settings over the mesh."),
  },
  "config.security.isManaged": {
    label: "Managed mode",
    help: "Only an admin key may change the config.",
    group: "Remote admin",
    danger: "lockout",
    warning: (v) =>
      v === true
        ? "The node will refuse local config changes except from an admin key: MeshTerm won't be able to edit it any more."
        : null,
  },
  "config.security.adminChannelEnabled": {
    label: "Legacy admin channel",
    help: 'Allow remote admin over a channel named "admin" (before admin keys).',
    group: "Remote admin",
    danger: "warn",
    warning: (v) =>
      v === true ? "Anyone with the admin channel's key can administer the node." : null,
  },
  "config.security.serialEnabled": {
    label: "Serial console",
    group: "Interfaces",
    danger: "warn",
    warning: (v) =>
      v === false
        ? "USB serial won't work for recovery (the phone app over Bluetooth still can)."
        : null,
  },
  "config.security.debugLogApiEnabled": {
    label: "Debug log over the API",
    group: "Interfaces",
    advanced: true,
  },
};

const airtime = (min: number) => (v: unknown) =>
  typeof v === "number" && v > 0 && v < min
    ? `Below ${min / 60} min this uses noticeable airtime on a busy mesh.`
    : null;

export const MODULE_FIELDS: Record<string, FieldMeta> = {
  "moduleConfig.mqtt.enabled": { label: "MQTT", group: "Server" },
  "moduleConfig.mqtt.address": {
    label: "Server",
    help: "Empty: the public Meshtastic server.",
    group: "Server",
  },
  "moduleConfig.mqtt.username": { label: "Username", group: "Server" },
  "moduleConfig.mqtt.password": { label: "Password", group: "Server", secret: true },
  "moduleConfig.mqtt.tlsEnabled": { label: "TLS", group: "Server" },
  "moduleConfig.mqtt.root": { label: "Root topic", group: "Server" },
  "moduleConfig.mqtt.encryptionEnabled": {
    label: "Send encrypted",
    help: "Upload packets still encrypted with the channel key.",
    group: "Server",
    danger: "warn",
    warning: (v) =>
      v === false ? "Messages are uploaded readable by anyone on the server." : null,
  },
  "moduleConfig.mqtt.jsonEnabled": { label: "JSON output", group: "Server", advanced: true },
  "moduleConfig.mqtt.proxyToClientEnabled": {
    label: "Through the client",
    help: "Use the connected app's internet connection.",
    group: "Server",
    advanced: true,
  },
  "moduleConfig.mqtt.mapReportingEnabled": {
    label: "Report to the map",
    help: "Publish this node's position and details to the public map.",
    group: "Server",
    danger: "warn",
    warning: (v) =>
      v === true ? "The node's position becomes public on the Meshtastic map." : null,
  },
  "moduleConfig.telemetry.deviceUpdateInterval": {
    label: "Device metrics interval",
    unit: "s",
    group: "Settings",
    warning: airtime(1800),
  },
  "moduleConfig.telemetry.environmentUpdateInterval": {
    label: "Environment interval",
    unit: "s",
    group: "Settings",
    warning: airtime(1800),
  },
  "moduleConfig.telemetry.environmentMeasurementEnabled": {
    label: "Environment sensors",
    group: "Settings",
  },
  "moduleConfig.telemetry.environmentScreenEnabled": {
    label: "Environment on screen",
    group: "Settings",
  },
  "moduleConfig.telemetry.powerMeasurementEnabled": { label: "Power sensors", group: "Settings" },
  "moduleConfig.neighborInfo.enabled": { label: "Neighbor info", group: "Settings" },
  "moduleConfig.neighborInfo.updateInterval": {
    label: "Interval",
    unit: "s",
    group: "Settings",
    warning: airtime(14_400),
  },
  "moduleConfig.rangeTest.enabled": {
    label: "Range test",
    group: "Settings",
    danger: "warn",
    warning: (v) =>
      v === true ? "The sender transmits test packets continuously: only for testing." : null,
  },
  "moduleConfig.storeForward.enabled": { label: "Store & forward", group: "Settings" },
};

/** Titles for module sections (others are humanized from the protobuf name). */
export const MODULE_TITLES: Record<string, string> = {
  mqtt: "MQTT",
  serial: "Serial",
  externalNotification: "External notification",
  storeForward: "Store & forward",
  rangeTest: "Range test",
  telemetry: "Telemetry",
  cannedMessage: "Canned messages",
  audio: "Audio",
  remoteHardware: "Remote hardware",
  neighborInfo: "Neighbor info",
  ambientLighting: "Ambient lighting",
  detectionSensor: "Detection sensor",
  paxcounter: "Paxcounter",
  statusmessage: "Status message",
};
