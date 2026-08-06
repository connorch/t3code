import { useEffect, useState } from "react";
import type { SidebarMode } from "@t3tools/contracts/settings";

import {
  useClientSettings,
  useSidebarMode,
  useUpdateClientSettings,
} from "../../hooks/useSettings";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const AUTO_SETTLE_MIN_DAYS = 1;
const AUTO_SETTLE_MAX_DAYS = 90;
const AUTO_SETTLE_DEFAULT_DAYS = 3;

const SIDEBAR_MODE_OPTIONS: Record<SidebarMode, { label: string; description: string }> = {
  default: {
    label: "Default",
    description: "Projects with nested thread lists — the classic sidebar.",
  },
  flat: {
    label: "Flat Mode",
    description:
      "One flat thread list in creation order. Active work renders as rich cards; settled threads collapse to compact rows. Settling requires an up-to-date server — on older servers threads simply stay active.",
  },
  "connor-1": {
    label: "Connor Mode",
    description:
      "Projects with threads grouped by git worktree as cards. One worktree open at a time (accordion); clicking a worktree jumps to its most recent thread.",
  },
};

const SIDEBAR_MODE_ORDER: readonly SidebarMode[] = ["default", "flat", "connor-1"];

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  // Local draft so the field can be emptied mid-edit; the setting only moves
  // on valid input and snaps back to the persisted value on blur.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      min={AUTO_SETTLE_MIN_DAYS}
      max={AUTO_SETTLE_MAX_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        // Number(), not parseInt: "3.5" must be rejected (not truncated to a
        // committed 3 while the field shows 3.5) — commit only when the
        // persisted value matches the displayed one.
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= AUTO_SETTLE_MIN_DAYS &&
          parsed <= AUTO_SETTLE_MAX_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Days of inactivity before auto-settle"
    />
  );
}

export function BetaSettingsPanel() {
  const sidebarMode = useSidebarMode();
  const sidebarAutoSettleAfterDays = useClientSettings(
    (settings) => settings.sidebarAutoSettleAfterDays,
  );
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Beta features">
        <SettingsRow
          {...searchableSetting("sidebar-v2")}
          description={SIDEBAR_MODE_OPTIONS[sidebarMode].description}
          control={
            <Select
              value={sidebarMode}
              onValueChange={(value) => {
                const mode = value as SidebarMode;
                // Picking a mode pins the choice (so a nightly build that
                // defaults Flat on does not flip it back), and dual-writes the
                // legacy boolean so downgraded builds keep flat-vs-default.
                updateSettings({
                  sidebarMode: mode,
                  sidebarV2Enabled: mode === "flat",
                  sidebarV2ConfiguredByUser: true,
                });
              }}
            >
              <SelectTrigger className="w-full sm:w-56" aria-label="Sidebar mode">
                <SelectValue>{SIDEBAR_MODE_OPTIONS[sidebarMode].label}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SIDEBAR_MODE_ORDER.map((mode) => (
                  <SelectItem key={mode} hideIndicator value={mode}>
                    {SIDEBAR_MODE_OPTIONS[mode].label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        {sidebarMode === "flat" ? (
          <>
            <SettingsRow
              title={searchableSetting("auto-settle-inactive-threads").title}
              description="Threads with no activity for this long settle automatically. Threads on merged or closed PRs always settle."
              control={
                <Switch
                  checked={sidebarAutoSettleAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label="Auto-settle inactive threads"
                />
              }
            />
            {sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                title="Days of inactivity before auto-settle"
                description="Any new activity un-settles a thread automatically."
                control={
                  <AutoSettleDaysInput
                    value={sidebarAutoSettleAfterDays}
                    onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
