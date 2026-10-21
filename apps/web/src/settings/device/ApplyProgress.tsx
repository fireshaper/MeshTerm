import type { ApplyPhase, ApplyStatusDTO } from "@meshterm/shared";
import { formatValue, labelFor } from "./format.js";

const STEPS: { phase: ApplyPhase; label: string }[] = [
  { phase: "applying", label: "Sending" },
  { phase: "rebooting", label: "Rebooting" },
  { phase: "reconnecting", label: "Reconnecting" },
  { phase: "verifying", label: "Verifying" },
];

export const TERMINAL: ReadonlySet<ApplyPhase> = new Set([
  "verified",
  "mismatched",
  "failed",
  "recovery",
]);

const TITLES: Record<ApplyPhase, string> = {
  applying: "Applying changes…",
  rebooting: "The node is rebooting…",
  reconnecting: "Reconnecting to the node…",
  verifying: "Checking the node's settings…",
  verified: "Applied and verified",
  mismatched: "Applied with differences",
  failed: "The changes weren't applied",
  recovery: "The node hasn't come back",
};

interface ApplyProgressProps {
  status: ApplyStatusDTO;
  /** Where MeshTerm connects to the node (for the recovery panel). */
  address: string | null;
  onDismiss: () => void;
}

/** Progress of an apply, then its result (CR-002 §5.3). */
export function ApplyProgress({ status, address, onDismiss }: ApplyProgressProps) {
  const done = TERMINAL.has(status.phase);
  const at = STEPS.findIndex((s) => s.phase === status.phase);
  return (
    <section
      data-mt="apply-progress"
      data-mt-state={status.phase}
      aria-label="Apply progress"
      aria-live="polite"
    >
      <h3 data-mt="apply-title">{TITLES[status.phase]}</h3>
      {!done && (
        <ol data-mt="apply-steps">
          {STEPS.map((step, i) => (
            <li
              key={step.phase}
              data-mt="apply-step"
              data-mt-state={i < at ? "done" : i === at ? "active" : "pending"}
            >
              {step.label}
            </li>
          ))}
        </ol>
      )}
      {status.phase === "verified" && (
        <p data-mt="detail-note">
          The node reports every changed value ({status.paths.length}) as sent.
        </p>
      )}
      {status.phase === "mismatched" && (
        <>
          <p data-mt="detail-note">
            The node changed or ignored some values (firmware may clamp or reject them):
          </p>
          <table data-mt="mismatch-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Sent</th>
                <th scope="col">On the node</th>
              </tr>
            </thead>
            <tbody>
              {status.mismatches.map((m) => (
                <tr key={m.path} data-mt="diff-row" data-path={m.path}>
                  <th scope="row">{labelFor(m.path)}</th>
                  <td>{formatValue(m.path, m.sent)}</td>
                  <td>{formatValue(m.path, m.actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {status.phase === "failed" && (
        <p data-mt="auth-error" role="alert">
          {status.error ?? "The node refused the changes."} Your edits are still pending.
        </p>
      )}
      {status.phase === "recovery" && (
        <div data-mt="recovery-panel" role="alert">
          <p>
            MeshTerm hasn&apos;t reconnected to the node within 3 minutes. It keeps trying
            {address ? (
              <>
                {" "}
                at <code>{address}</code>
              </>
            ) : null}
            {status.newHost ? (
              <>
                {" "}
                and at the new address <code>{status.newHost}</code>
              </>
            ) : null}
            .
          </p>
          <p>Changed: {status.paths.map((p) => labelFor(p)).join(", ")}.</p>
          <ul>
            <li>Check the node has power and is on the same network.</li>
            <li>
              Connect with the Meshtastic phone app over Bluetooth, or over USB serial, to see or
              undo the change.
            </li>
            <li>As a last resort, a factory reset restores the defaults (network settings too).</li>
          </ul>
        </div>
      )}
      {done && (
        <button type="button" data-mt="button" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </section>
  );
}
