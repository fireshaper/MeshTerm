import * as Dialog from "@radix-ui/react-dialog";
import { TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { Edit, EditSummary } from "./edits.js";
import { formatChange, labelFor } from "./format.js";
import { SECTIONS, metaFor, sectionOf, type Getter } from "./registry.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edits: Record<string, Edit>;
  summary: EditSummary;
  get: Getter;
  /** The node's short name, typed to confirm lockout-class changes. */
  shortName: string;
  busy: boolean;
  onApply: () => void;
  /** A pending static IP: MeshTerm tries the current address and this one after the reboot. */
  addresses?: { current: string; next: string } | null;
}

/** Every pending change by section, warnings, and the apply button (CR-002 §5.3, §7). */
export function ReviewDialog(props: ReviewDialogProps) {
  const { edits, summary, get, shortName } = props;
  const [typed, setTyped] = useState("");
  const needsTyped = summary.lockout.length > 0;
  const confirmed = !needsTyped || typed.trim() === shortName;
  const blocked = summary.invalid.length > 0 || summary.conflicts.length > 0;
  const n = summary.count;

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setTyped("");
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content data-mt="review-dialog" aria-describedby="review-note">
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">Review changes</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <div data-mt="review-body">
            {SECTIONS.filter((s) => summary.bySection[s.id]).map((section) => (
              <section key={section.id} data-mt="review-section" aria-label={section.title}>
                <h3 data-mt="review-section-title">{section.title}</h3>
                <table data-mt="review-table">
                  <tbody>
                    {Object.entries(edits)
                      .filter(([path]) => sectionOf(path) === section.id)
                      .map(([path, edit]) => {
                        const meta = metaFor(path);
                        const [from, to] = formatChange(path, edit.base, edit.value);
                        const warning = meta.warning?.(edit.value, get);
                        const state = summary.invalid.includes(path)
                          ? "invalid"
                          : summary.conflicts.includes(path)
                            ? "conflict"
                            : undefined;
                        return (
                          <tr
                            key={path}
                            data-mt="diff-row"
                            data-mt-state={state}
                            data-mt-variant={meta.danger}
                            data-path={path}
                          >
                            <th scope="row">{labelFor(path, get)}</th>
                            <td data-mt="diff-from">{from}</td>
                            <td data-mt="diff-arrow" aria-label="to">
                              →
                            </td>
                            <td data-mt="diff-to">{to}</td>
                            <td data-mt="diff-note">
                              {warning && (
                                <>
                                  <TriangleAlert data-mt="icon" {...ICON} /> {warning}
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </section>
            ))}
            {summary.invalid.length > 0 && (
              <p data-mt="review-blocked" role="alert">
                Fix the highlighted fields first
                {summary.invalid.includes("config.lora.region") &&
                get("config.lora.region") === "UNSET"
                  ? " (set the LoRa region: other LoRa changes need it)"
                  : ""}
                .
              </p>
            )}
            {summary.conflicts.length > 0 && (
              <p data-mt="review-blocked" role="alert">
                Some fields changed on the device since you edited them. Resolve them first.
              </p>
            )}
            {props.addresses && (
              <p data-mt="review-address" role="note">
                After the reboot MeshTerm tries <code>{props.addresses.current}</code> and then the
                new address <code>{props.addresses.next}</code>, and keeps the one that answers.
              </p>
            )}
            <p data-mt="review-note" id="review-note">
              {summary.reboot
                ? "The node will save the settings and reboot. MeshTerm reconnects automatically (usually 20–60 s)."
                : "The node will save the settings; it doesn't need to reboot."}
            </p>
            {needsTyped && (
              <label data-mt="typed-confirm">
                <span>
                  This change can lock MeshTerm out of the node. Type the node&apos;s short name{" "}
                  <strong>{shortName}</strong> to confirm.
                </span>
                <input
                  data-mt="typed-confirm-input"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                  }}
                />
              </label>
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
              disabled={blocked || !confirmed || props.busy}
              onClick={props.onApply}
            >
              Apply {n} {n === 1 ? "change" : "changes"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
