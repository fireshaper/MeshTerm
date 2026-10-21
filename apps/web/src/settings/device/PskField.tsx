import { SECRET_MASK } from "@meshterm/shared";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { api } from "../../data/api.js";
import { useUiStore } from "../../data/ui-store.js";
import type { InputCommon } from "./ConfigField.js";
import { DEFAULT_PSK, pskBytes } from "./registry.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

type Mode = "default" | "none" | "random128" | "random256" | "custom";

const modeOf = (psk: string): Mode =>
  psk === "" ? "none" : psk === DEFAULT_PSK ? "default" : "custom";

interface PskFieldProps {
  common: InputCommon;
  value: unknown;
  onChange: (psk: string) => void;
}

/** A channel key: default, none, random 128/256-bit (server CSPRNG) or pasted; show and copy. */
export function PskField({ common, value, onChange }: PskFieldProps) {
  const toast = useUiStore((s) => s.toast);
  const psk = typeof value === "string" ? value : "";
  const masked = psk === SECRET_MASK;
  const [show, setShow] = useState(false);
  const [pasting, setPasting] = useState(false);
  const mode = pasting ? "custom" : modeOf(psk);
  const bytes = pskBytes(psk);

  async function choose(next: Mode) {
    setPasting(next === "custom");
    if (next === "default") onChange(DEFAULT_PSK);
    else if (next === "none") onChange("");
    else if (next === "random128" || next === "random256") {
      try {
        onChange((await api.randomPsk(next === "random128" ? 128 : 256)).psk);
      } catch {
        toast("Couldn't make a key. Try again.", "error");
      }
    }
  }

  return (
    <div data-mt="psk-field" data-mt-state={mode}>
      <select
        aria-label="Key type"
        disabled={common.disabled || masked}
        value={mode}
        onChange={(e) => void choose(e.target.value as Mode)}
      >
        <option value="default">Default (public)</option>
        <option value="none">None (unencrypted)</option>
        <option value="random128">New random 128-bit key</option>
        <option value="random256">New random 256-bit key</option>
        <option value="custom">
          {mode === "custom" && bytes ? `Custom (${bytes * 8}-bit)` : "Paste a key…"}
        </option>
      </select>
      {mode === "custom" && (
        <div data-mt="psk-key">
          <input
            {...common}
            type={show && !masked ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="base64"
            value={psk}
            disabled={common.disabled || masked}
            onChange={(e) => {
              onChange(e.target.value.trim());
            }}
          />
          <button
            type="button"
            data-mt="icon-button"
            aria-label={show ? "Hide key" : "Show key"}
            aria-pressed={show}
            disabled={masked}
            onClick={() => {
              setShow((s) => !s);
            }}
          >
            {show ? <EyeOff data-mt="icon" {...ICON} /> : <Eye data-mt="icon" {...ICON} />}
          </button>
          <button
            type="button"
            data-mt="icon-button"
            aria-label="Copy key"
            disabled={masked || psk === ""}
            onClick={() => {
              void navigator.clipboard.writeText(psk).then(
                () => {
                  toast("Key copied.", "success");
                },
                () => {
                  toast("Couldn't copy the key.", "error");
                },
              );
            }}
          >
            <Copy data-mt="icon" {...ICON} />
          </button>
        </div>
      )}
    </div>
  );
}
