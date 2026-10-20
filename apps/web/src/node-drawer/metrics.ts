import { formatDuration } from "../dashboard/format.js";

/** How to show one telemetry metric (snake_case protobuf name). */
export interface MetricInfo {
  label: string;
  unit: string;
  /** Decimal places. */
  digits: number;
}

const KNOWN: Record<string, MetricInfo> = {
  battery_level: { label: "Battery", unit: "%", digits: 0 },
  voltage: { label: "Voltage", unit: "V", digits: 2 },
  channel_utilization: { label: "Channel util", unit: "%", digits: 1 },
  air_util_tx: { label: "Air util TX", unit: "%", digits: 1 },
  uptime_seconds: { label: "Uptime", unit: "s", digits: 0 },
  temperature: { label: "Temperature", unit: "°C", digits: 1 },
  relative_humidity: { label: "Humidity", unit: "%", digits: 0 },
  barometric_pressure: { label: "Pressure", unit: "hPa", digits: 1 },
  gas_resistance: { label: "Gas resistance", unit: "MΩ", digits: 1 },
  iaq: { label: "Air quality index", unit: "", digits: 0 },
  current: { label: "Current", unit: "mA", digits: 1 },
  distance: { label: "Distance", unit: "mm", digits: 0 },
  lux: { label: "Light", unit: "lx", digits: 0 },
  white_lux: { label: "White light", unit: "lx", digits: 0 },
  ir_lux: { label: "Infrared light", unit: "lx", digits: 0 },
  uv_lux: { label: "UV light", unit: "lx", digits: 0 },
  wind_direction: { label: "Wind direction", unit: "°", digits: 0 },
  wind_speed: { label: "Wind speed", unit: "m/s", digits: 1 },
  wind_gust: { label: "Wind gust", unit: "m/s", digits: 1 },
  wind_lull: { label: "Wind lull", unit: "m/s", digits: 1 },
  weight: { label: "Weight", unit: "kg", digits: 2 },
  radiation: { label: "Radiation", unit: "µR/h", digits: 1 },
  rainfall1h: { label: "Rain (1 h)", unit: "mm", digits: 1 },
  rainfall24h: { label: "Rain (24 h)", unit: "mm", digits: 1 },
  soil_moisture: { label: "Soil moisture", unit: "%", digits: 0 },
  soil_temperature: { label: "Soil temperature", unit: "°C", digits: 1 },
  pm10_standard: { label: "PM1.0", unit: "µg/m³", digits: 0 },
  pm25_standard: { label: "PM2.5", unit: "µg/m³", digits: 0 },
  pm100_standard: { label: "PM10", unit: "µg/m³", digits: 0 },
  pm10_environmental: { label: "PM1.0 (env)", unit: "µg/m³", digits: 0 },
  pm25_environmental: { label: "PM2.5 (env)", unit: "µg/m³", digits: 0 },
  pm100_environmental: { label: "PM10 (env)", unit: "µg/m³", digits: 0 },
  co2: { label: "CO₂", unit: "ppm", digits: 0 },
};

/** "gas_resistance" → "Gas resistance" for names we don't know. */
const humanize = (name: string) => {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function metricInfo(name: string): MetricInfo {
  const known = KNOWN[name];
  if (known) return known;
  const channel = /^ch(\d+)_(voltage|current)$/.exec(name);
  if (channel) {
    return channel[2] === "voltage"
      ? { label: `Channel ${channel[1]} voltage`, unit: "V", digits: 2 }
      : { label: `Channel ${channel[1]} current`, unit: "mA", digits: 0 };
  }
  return { label: humanize(name), unit: "", digits: 2 };
}

/** "21.5 °C", "78%", "3d 4h" (uptime), "External power" (battery > 100). */
export function formatMetric(name: string, value: number): string {
  if (name === "uptime_seconds") return formatDuration(value);
  if (name === "battery_level" && value > 100) return "External power";
  const { unit, digits } = metricInfo(name);
  const text = value.toFixed(digits);
  if (!unit) return text;
  return unit === "%" || unit === "°" ? `${text}${unit}` : `${text} ${unit}`;
}

/** Metrics of a report in a stable order: known ones as listed above, then alphabetical. */
export function orderedMetrics(metrics: Record<string, number>): [string, number][] {
  const order = Object.keys(KNOWN);
  return Object.entries(metrics).sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
  });
}
