import { randomBytes } from "node:crypto";
import {
  AppOnly,
  Channel,
  Config,
  create,
  fromBinary,
  toBinary,
  toJson,
  type JsonValue,
} from "@meshterm/protocol";
import type { ParsedChannelUrlDTO, ProtoJson, QrDTO } from "@meshterm/shared";
import { encode } from "uqr";

/** Where the Meshtastic apps' channel links point; the ChannelSet follows `#`. */
export const CHANNEL_URL_BASE = "https://meshtastic.org/e/";

const OPTS = { alwaysEmitImplicit: true } as const;
const json = (v: JsonValue) => (v ?? {}) as ProtoJson;

/**
 * The channel link for these channels (first = primary in the receiving app) and,
 * optionally, the LoRa settings: base64url of a `ChannelSet`, no padding, after `#`.
 */
export function encodeChannelUrl(
  settings: readonly Channel.ChannelSettings[],
  lora: Config.Config_LoRaConfig | null,
): string {
  const set = create(AppOnly.ChannelSetSchema, {
    settings: [...settings],
    ...(lora ? { loraConfig: lora } : {}),
  });
  return `${CHANNEL_URL_BASE}#${Buffer.from(toBinary(AppOnly.ChannelSetSchema, set)).toString("base64url")}`;
}

export class ChannelUrlError extends Error {}

/**
 * Parses a channel link (`…/e/#<b64>` or `…/e/?add=true#<b64>`; base64 or base64url,
 * padded or not) into its channels and LoRa settings, as proto JSON.
 */
export function parseChannelUrl(url: string): ParsedChannelUrlDTO {
  const text = url.trim();
  const hash = text.indexOf("#");
  if (hash < 0) throw new ChannelUrlError("not a channel link: no # part");
  const payload = text.slice(hash + 1).replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/_-]+$/.test(payload))
    throw new ChannelUrlError("not a channel link: bad encoding");
  let set: AppOnly.ChannelSet;
  try {
    set = fromBinary(
      AppOnly.ChannelSetSchema,
      Buffer.from(payload.replaceAll("-", "+").replaceAll("_", "/"), "base64"),
    );
  } catch {
    throw new ChannelUrlError("not a channel link: it doesn't decode");
  }
  if (set.settings.length === 0) throw new ChannelUrlError("the link has no channels");
  if (set.settings.length > 8) throw new ChannelUrlError("the link has more than 8 channels");
  return {
    settings: set.settings.map((s) => json(toJson(Channel.ChannelSettingsSchema, s, OPTS))),
    lora: set.loraConfig
      ? json(toJson(Config.Config_LoRaConfigSchema, set.loraConfig, OPTS))
      : null,
    add: /[?&]add=true\b/.test(text.slice(0, hash)),
  };
}

/** A QR code as one SVG path of its dark modules (1 unit per module, quiet zone included). */
export function qrCode(text: string): QrDTO {
  const { size, data } = encode(text, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return { size, path };
}

/** A new channel key from the server's CSPRNG (CR-002 §5.4), base64. */
export function randomPsk(bits: 128 | 256): string {
  return randomBytes(bits / 8).toString("base64");
}
