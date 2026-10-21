import { Admin, Channel, clone, Config, create, Mesh, ModuleConfig } from "@meshterm/protocol";
import type { Scenario, ScenarioNode } from "./scenario.js";

export interface FakeAdminOptions {
  /** Reject sets whose `session_passkey` isn't the one last handed out (firmware ≥ 2.5). */
  requirePasskey: boolean;
  /** After `commit_edit_settings`, drop the link and come back after this long; 0 = no reboot. */
  rebootOnCommitMs: number;
  /** Change a config the way firmware might clamp it (e.g. TX power to the region's maximum). */
  clamp: ((config: Config.Config) => Config.Config) | null;
  /** Forget the passkey right after `begin_edit_settings` (as if it expired), to test the retry. */
  expirePasskeyOnBegin: boolean;
  /**
   * After the commit, reboot without the link noticing (as over Wi-Fi): the socket stays
   * open but nothing is answered until a client connects again.
   */
  silentRebootOnCommit: boolean;
  /** How long a shutdown keeps the node away (a real one needs someone to power it on). */
  shutdownDownMs: number;
}

export const DEFAULT_ADMIN_OPTIONS: FakeAdminOptions = {
  requirePasskey: true,
  rebootOnCommitMs: 1_500,
  clamp: null,
  expirePasskeyOnBegin: false,
  shutdownDownMs: 4_000,
  silentRebootOnCommit: false,
};

type AdminReply =
  | { kind: "response"; message: Admin.AdminMessage }
  | { kind: "routing"; error: Mesh.Routing_Error }
  | { kind: "reboot"; afterMs: number }
  /** Forget every node but our own. */
  | { kind: "nodedbReset" };

/** `LORA_CONFIG` → `lora`, `DEVICEUI_CONFIG` → `deviceUi`: the oneof case with those letters. */
function caseFor(enumName: string, cases: readonly string[]): string | undefined {
  const special: Record<string, string> = {
    EXTNOTIF: "externalNotification",
    CANNEDMSG: "cannedMessage",
  };
  const letters = enumName.replace(/_CONFIG$/, "");
  return (
    special[letters] ??
    cases.find((c) => c.toLowerCase() === letters.replace(/_/g, "").toLowerCase())
  );
}

/** An enum value's name ("" for a value this protobufs version doesn't know). */
const enumName = (e: object, value: number): string => {
  const name: unknown = (e as Record<number, unknown>)[value];
  return typeof name === "string" ? name : "";
};

const CONFIG_CASES = Config.ConfigSchema.fields.map((f) => f.localName);
const MODULE_CASES = ModuleConfig.ModuleConfigSchema.fields.map((f) => f.localName);

/**
 * The firmware's admin module, enough for MeshTerm's config editor (CR-002 §9): get
 * responses carry a session passkey; sets need it; begin/commit; commit reboots.
 * State lives in the scenario, so the next handshake reports what was set.
 */
export class FakeAdmin {
  options: FakeAdminOptions = { ...DEFAULT_ADMIN_OPTIONS };
  /** Variant cases received, in order (for tests). */
  readonly log: string[] = [];
  private passkey = new Uint8Array();
  private editing = false;
  /** Rebooting silently: nothing is answered until the next handshake. */
  muted = false;
  /** The scenario's settings as loaded: what a factory reset goes back to. */
  private readonly factory: Pick<Scenario, "config" | "moduleConfig" | "channels">;

  constructor(
    private readonly scenario: Scenario,
    private readonly own: () => ScenarioNode | undefined,
    private readonly random: () => number = Math.random,
  ) {
    this.factory = {
      config: scenario.config.map((c) => clone(Config.ConfigSchema, c)),
      moduleConfig: scenario.moduleConfig.map((c) => clone(ModuleConfig.ModuleConfigSchema, c)),
      channels: scenario.channels.map((c) => clone(Channel.ChannelSchema, c)),
    };
  }

  private factoryReset(): void {
    this.scenario.config = this.factory.config.map((c) => clone(Config.ConfigSchema, c));
    this.scenario.moduleConfig = this.factory.moduleConfig.map((c) =>
      clone(ModuleConfig.ModuleConfigSchema, c),
    );
    this.scenario.channels = this.factory.channels.map((c) => clone(Channel.ChannelSchema, c));
  }

  /** A reboot (or new link) invalidates the passkey. */
  resetSession(): void {
    this.passkey = new Uint8Array();
    this.editing = false;
  }

  get inTransaction(): boolean {
    return this.editing;
  }

  handle(message: Admin.AdminMessage): AdminReply[] {
    const v = message.payloadVariant;
    this.log.push(v.case ?? "empty");
    if (this.muted) return [];
    const respond = (payloadVariant: Admin.AdminMessage["payloadVariant"]): AdminReply[] => [
      {
        kind: "response",
        message: create(Admin.AdminMessageSchema, {
          payloadVariant: payloadVariant as never,
          sessionPasskey: this.issuePasskey(),
        }),
      },
    ];
    switch (v.case) {
      case "getOwnerRequest":
        return respond({
          case: "getOwnerResponse",
          value: this.own()?.info.user ?? create(Mesh.UserSchema),
        });
      case "getChannelRequest": {
        const channel =
          this.scenario.channels.find((c) => c.index === v.value - 1) ??
          create(Channel.ChannelSchema, { index: v.value - 1 });
        return respond({ case: "getChannelResponse", value: channel });
      }
      case "getConfigRequest": {
        const name = enumName(Admin.AdminMessage_ConfigType, v.value);
        const section = caseFor(name, CONFIG_CASES);
        const config =
          this.scenario.config.find((c) => c.payloadVariant.case === section) ??
          create(Config.ConfigSchema);
        return respond({ case: "getConfigResponse", value: config });
      }
      case "getModuleConfigRequest": {
        const name = enumName(Admin.AdminMessage_ModuleConfigType, v.value);
        const section = caseFor(name, MODULE_CASES);
        const config =
          this.scenario.moduleConfig.find((c) => c.payloadVariant.case === section) ??
          create(ModuleConfig.ModuleConfigSchema);
        return respond({ case: "getModuleConfigResponse", value: config });
      }
      default:
        break;
    }

    // Everything else changes something: it needs the passkey.
    const ok =
      !this.options.requirePasskey ||
      (this.passkey.length > 0 &&
        message.sessionPasskey.length === this.passkey.length &&
        message.sessionPasskey.every((b, i) => b === this.passkey[i]));
    if (!ok) return [{ kind: "routing", error: Mesh.Routing_Error.ADMIN_BAD_SESSION_KEY }];
    const ack: AdminReply = { kind: "routing", error: Mesh.Routing_Error.NONE };

    switch (v.case) {
      case "beginEditSettings":
        this.editing = true;
        if (this.options.expirePasskeyOnBegin) this.passkey = new Uint8Array();
        return [ack];
      case "commitEditSettings": {
        this.editing = false;
        if (this.options.silentRebootOnCommit) {
          this.muted = true;
          return [];
        }
        const ms = this.options.rebootOnCommitMs;
        return ms > 0 ? [ack, { kind: "reboot", afterMs: ms }] : [ack];
      }
      case "setOwner": {
        const own = this.own();
        if (own) own.info = create(Mesh.NodeInfoSchema, { ...own.info, user: v.value });
        return [ack];
      }
      case "setChannel": {
        const i = this.scenario.channels.findIndex((c) => c.index === v.value.index);
        if (i >= 0) this.scenario.channels[i] = v.value;
        else this.scenario.channels.push(v.value);
        this.scenario.channels.sort((a, b) => a.index - b.index);
        return [ack];
      }
      case "setConfig": {
        const value = this.options.clamp ? this.options.clamp(v.value) : v.value;
        const i = this.scenario.config.findIndex(
          (c) => c.payloadVariant.case === value.payloadVariant.case,
        );
        if (i >= 0) this.scenario.config[i] = value;
        else this.scenario.config.push(value);
        return [ack];
      }
      case "setModuleConfig": {
        const i = this.scenario.moduleConfig.findIndex(
          (c) => c.payloadVariant.case === v.value.payloadVariant.case,
        );
        if (i >= 0) this.scenario.moduleConfig[i] = v.value;
        else this.scenario.moduleConfig.push(v.value);
        return [ack];
      }
      case "setFixedPosition": {
        const own = this.own();
        if (own) own.info = create(Mesh.NodeInfoSchema, { ...own.info, position: v.value });
        this.setPositionFixed(true);
        return [ack];
      }
      case "removeFixedPosition":
        this.setPositionFixed(false);
        return [ack];
      case "rebootSeconds":
        return [ack, { kind: "reboot", afterMs: Math.max(1, v.value) * 1000 }];
      case "shutdownSeconds":
        return [ack, { kind: "reboot", afterMs: this.options.shutdownDownMs }];
      case "nodedbReset":
        return [ack, { kind: "nodedbReset" }];
      case "factoryResetConfig":
        this.factoryReset();
        return [ack, { kind: "reboot", afterMs: this.options.rebootOnCommitMs || 1_500 }];
      case "factoryResetDevice":
        this.factoryReset();
        return [
          ack,
          { kind: "nodedbReset" },
          { kind: "reboot", afterMs: this.options.rebootOnCommitMs || 1_500 },
        ];
      default:
        return [ack];
    }
  }

  private setPositionFixed(fixed: boolean): void {
    const i = this.scenario.config.findIndex((c) => c.payloadVariant.case === "position");
    const current = this.scenario.config[i];
    const position =
      current?.payloadVariant.case === "position"
        ? current.payloadVariant.value
        : create(Config.Config_PositionConfigSchema);
    const next = create(Config.ConfigSchema, {
      payloadVariant: { case: "position", value: { ...position, fixedPosition: fixed } },
    });
    if (i >= 0) this.scenario.config[i] = next;
    else this.scenario.config.push(next);
  }

  private issuePasskey(): Uint8Array {
    if (this.passkey.length === 0) {
      this.passkey = Uint8Array.from({ length: 8 }, () => Math.floor(this.random() * 256));
    }
    return this.passkey;
  }
}
