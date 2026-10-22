import type { ThemeDTO, ThemeManifest, ThemesDTO } from "@meshterm/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../data/keys.js";
import { useThemeStore } from "../theme/store.js";
import { renderApp } from "../test/render-app.js";
import { TEST_VIEWER } from "../test/me.js";

const theme = (id: string, extra: Partial<ThemeDTO> = {}, scheme = "dark"): ThemeDTO => ({
  id,
  source: "builtin",
  hash: `h-${id}`,
  valid: true,
  manifest: {
    id,
    name: id === "default" ? "Default" : `Theme ${id}`,
    author: "MeshTerm",
    version: "1.0.0",
    colorScheme: scheme as "dark",
    preview: { bg: "#000", surface: "#111", accent: "#0af", text: "#fff" },
    entry: "theme.css",
  },
  ...extra,
});

function manifestOf(t: ThemeDTO): ThemeManifest {
  if (!t.manifest) throw new Error("no manifest");
  return t.manifest;
}

const THEMES: ThemesDTO = {
  defaultId: "default",
  themes: [
    theme("default", {}, "auto"),
    theme("retro", {
      manifest: { ...manifestOf(theme("retro")), effects: ["scanlines"], description: "Green" },
    }),
    theme("mine", { source: "user", warnings: ["mine.css loads something from outside MeshTerm"] }),
    theme("broken", { source: "user", valid: false, manifest: null, error: "no theme.json" }),
  ],
};

let calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  useThemeStore.setState({ chosenId: null, previewId: null, modePref: "system" });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      const json = (b: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(b), { status }));
      if (url === "/api/themes") return json(THEMES);
      if (url === "/api/themes/default") return json(body);
      if (url.endsWith("/duplicate")) {
        return json(theme(String(body?.newId), { source: "user" }), 201);
      }
      return json([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const render = (me?: typeof TEST_VIEWER) =>
  renderApp("/settings/appearance", {
    queries: [[queryKeys.themes, THEMES]],
    ...(me ? { me } : {}),
  });

describe("Settings → Appearance (CR-004 §4.7)", () => {
  it("shows a card per theme with its source, effects and (admins) problems", async () => {
    await render();
    const cards = screen.getAllByRole("radio");
    expect(cards.map((c) => c.getAttribute("data-mt-variant"))).toEqual([
      "builtin",
      "builtin",
      "user",
      "user",
    ]);
    expect(cards[0]).toHaveAttribute("data-mt-state", "active");
    expect(cards[0]).toHaveAttribute("aria-checked", "true");
    expect(within(cards[1] as HTMLElement).getByText("Effects")).toBeInTheDocument();
    expect(within(cards[2] as HTMLElement).getByText(/outside MeshTerm/)).toBeInTheDocument();
    expect(cards[3]).toBeDisabled();
    expect(cards[3]).toHaveAttribute("data-mt-state", "broken");
    expect(within(cards[3] as HTMLElement).getByText("Broken: no theme.json")).toBeInTheDocument();
  });

  it("previews on hover, restores on leave, and saves on click", async () => {
    const user = userEvent.setup();
    await render();
    const retro = screen.getByRole("radio", { name: /Theme retro/ });
    await user.hover(retro);
    expect(useThemeStore.getState().previewId).toBe("retro");
    expect(retro).toHaveAttribute("data-mt-state", "previewing");
    await user.unhover(screen.getByRole("radiogroup", { name: "Theme" }));
    expect(useThemeStore.getState().previewId).toBeNull();
    await user.click(retro);
    expect(useThemeStore.getState()).toMatchObject({ chosenId: "retro", previewId: null });
    expect(retro).toHaveAttribute("data-mt-state", "active");
  });

  it("mode applies to auto themes only", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(useThemeStore.getState().modePref).toBe("light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("radio", { name: /Theme retro/ }));
    expect(screen.getByRole("group", { name: "Mode" })).toBeDisabled();
    expect(screen.getByText("Theme retro has a fixed dark look.")).toBeInTheDocument();
  });

  it("admins set the server default and duplicate the selected theme", async () => {
    const user = userEvent.setup();
    await render();
    await user.selectOptions(screen.getByLabelText("Server default theme"), "retro");
    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/themes/default",
        method: "PUT",
        body: { id: "retro" },
      });
    });
    await user.click(screen.getByRole("button", { name: "Duplicate Default as a user theme" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Folder and id")).toHaveValue("default-copy");
    await user.clear(within(dialog).getByLabelText("Folder and id"));
    await user.type(within(dialog).getByLabelText("Folder and id"), "Bad Id");
    expect(within(dialog).getByRole("button", { name: "Duplicate" })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Folder and id"));
    await user.type(within(dialog).getByLabelText("Folder and id"), "my-default");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/themes/default/duplicate",
        method: "POST",
        body: { newId: "my-default", name: "Default copy" },
      });
    });
    expect(useThemeStore.getState().chosenId).toBe("my-default");
  });

  it("viewers see neither broken themes' errors nor admin settings", async () => {
    await render(TEST_VIEWER);
    expect(screen.queryByLabelText("Server default theme")).not.toBeInTheDocument();
    expect(screen.queryByText(/Broken:/)).not.toBeInTheDocument();
  });
});

describe("effects toggle (CR-004 §7)", () => {
  it("is off for themes without effects and saves the choice per browser", async () => {
    const user = userEvent.setup();
    await render();
    const toggle = screen.getByLabelText("Enable theme effects");
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Default has no effects.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Theme retro/ }));
    expect(toggle).toBeEnabled();
    expect(
      screen.getByText("Theme retro draws scanlines over the page.", { exact: false }),
    ).toBeInTheDocument();
    await user.click(toggle);
    expect(useThemeStore.getState().effectsEnabled).toBe(false);
    expect(localStorage.getItem("meshterm.effects")).toBe("false");
    await user.click(toggle);
    expect(useThemeStore.getState().effectsEnabled).toBe(true);
  });
});
