import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
  resolveSidebarMode,
  resolveSidebarV2Default,
  resolveSidebarV2Enabled,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "T3 Code",
            stageLabel: "Nightly",
            displayName: "T3 Code (Nightly)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("T3 Code");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code (Nightly)");
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nightly");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code (Nightly)");
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });
});

describe("branding logic", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("updates the display name for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("T3 Code (Nightly)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("T3 Code (Alpha)");
  });

  it("keeps the fallback display name for malformed nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("T3 Code (Alpha)");
  });
});

describe("resolveSidebarV2Default", () => {
  it.each(["Nightly", "Dev", "nightly", " dev "])("enables the beta for %s builds", (stage) => {
    expect(resolveSidebarV2Default(stage)).toBe(true);
  });

  it.each(["Alpha", "Latest", ""])("leaves the beta off for %s builds", (stage) => {
    expect(resolveSidebarV2Default(stage)).toBe(false);
  });
});

describe("resolveSidebarV2Enabled", () => {
  const hydrated = { settingsHydrated: true } as const;

  it.each(["Alpha", "Latest"])(
    "keeps a legacy opt-in on %s builds even without the companion flag",
    (stageLabel) => {
      // `true` was never the schema default, so it can only be an explicit
      // opt-in from settings written before `sidebarV2ConfiguredByUser` existed.
      expect(
        resolveSidebarV2Enabled({
          ...hydrated,
          enabled: true,
          configuredByUser: false,
          stageLabel,
        }),
      ).toBe(true);
    },
  );

  it("applies the stage default when the beta was never enabled or configured", () => {
    expect(
      resolveSidebarV2Enabled({
        ...hydrated,
        enabled: false,
        configuredByUser: false,
        stageLabel: "Nightly",
      }),
    ).toBe(true);
    expect(
      resolveSidebarV2Enabled({
        ...hydrated,
        enabled: false,
        configuredByUser: false,
        stageLabel: "Latest",
      }),
    ).toBe(false);
  });

  it("honors an explicit opt-out over the stage default", () => {
    expect(
      resolveSidebarV2Enabled({
        ...hydrated,
        enabled: false,
        configuredByUser: true,
        stageLabel: "Nightly",
      }),
    ).toBe(false);
  });

  it("holds v1 until settings hydrate so the sidebar does not remount", () => {
    expect(
      resolveSidebarV2Enabled({
        enabled: true,
        configuredByUser: true,
        settingsHydrated: false,
        stageLabel: "Nightly",
      }),
    ).toBe(false);
  });
});

describe("resolveSidebarMode", () => {
  const hydrated = { settingsHydrated: true } as const;
  const legacyUnset = { enabled: false, configuredByUser: false } as const;

  it("returns the stored enum when the user picked a mode", () => {
    for (const mode of ["default", "flat", "connor-1"] as const) {
      expect(resolveSidebarMode({ ...hydrated, ...legacyUnset, mode, stageLabel: "Latest" })).toBe(
        mode,
      );
    }
  });

  it("wins over the legacy boolean pair when both are set", () => {
    expect(
      resolveSidebarMode({
        ...hydrated,
        mode: "connor-1",
        enabled: true,
        configuredByUser: true,
        stageLabel: "Latest",
      }),
    ).toBe("connor-1");
  });

  it("maps a legacy v2 opt-in to flat when no mode is stored", () => {
    expect(
      resolveSidebarMode({
        ...hydrated,
        mode: null,
        enabled: true,
        configuredByUser: true,
        stageLabel: "Latest",
      }),
    ).toBe("flat");
  });

  it("applies the stage default for untouched settings", () => {
    expect(
      resolveSidebarMode({ ...hydrated, ...legacyUnset, mode: null, stageLabel: "Nightly" }),
    ).toBe("flat");
    expect(
      resolveSidebarMode({ ...hydrated, ...legacyUnset, mode: null, stageLabel: "Latest" }),
    ).toBe("default");
  });

  it("honors a legacy explicit opt-out over the stage default", () => {
    expect(
      resolveSidebarMode({
        ...hydrated,
        mode: null,
        enabled: false,
        configuredByUser: true,
        stageLabel: "Nightly",
      }),
    ).toBe("default");
  });

  it("holds the default sidebar until settings hydrate", () => {
    expect(
      resolveSidebarMode({
        mode: "connor-1",
        enabled: true,
        configuredByUser: true,
        settingsHydrated: false,
        stageLabel: "Nightly",
      }),
    ).toBe("default");
  });
});
