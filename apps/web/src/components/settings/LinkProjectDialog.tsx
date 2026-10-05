import { useMemo, useState } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SelectButton } from "../ui/select";

/**
 * Where a candidate group lives, so same-named projects stay apart. A single
 * checkout shows its path too, since two folders on one machine share a label.
 */
function describeGroupLocation(group: SidebarProjectSnapshot): string {
  const only = group.memberProjects.length === 1 ? group.memberProjects[0] : undefined;
  if (only) {
    return only.environmentLabel
      ? `${only.environmentLabel} · ${only.workspaceRoot}`
      : only.workspaceRoot;
  }
  return group.memberProjects
    .map((member) => member.environmentLabel)
    .filter((label): label is string => label !== null)
    .filter((label, index, all) => all.indexOf(label) === index)
    .join(", ");
}

/**
 * Picks another project group to merge with the current one. Mounted only
 * while open so the pick and name reset on every visit.
 */
export function LinkProjectDialog({
  currentGroup,
  candidates,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  currentGroup: SidebarProjectSnapshot;
  candidates: ReadonlyArray<SidebarProjectSnapshot>;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { target: SidebarProjectSnapshot; name: string }) => void;
}) {
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState(currentGroup.displayName);

  const target = useMemo(
    () => candidates.find((group) => group.projectKey === targetKey) ?? null,
    [candidates, targetKey],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return candidates;
    return candidates.filter(
      (group) =>
        group.displayName.toLowerCase().includes(needle) ||
        describeGroupLocation(group).toLowerCase().includes(needle),
    );
  }, [candidates, query]);
  const filteredKeys = filtered.map((group) => group.projectKey);

  const submit = () => {
    const trimmed = name.trim();
    if (!target || trimmed.length === 0 || isSubmitting) return;
    onSubmit({ target, name: trimmed });
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link project</DialogTitle>
          <DialogDescription>
            Linked projects appear as one project and new threads can start on any of their
            machines. Links are saved on this device.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Link with</span>
            <Combobox
              items={filteredKeys}
              filteredItems={filteredKeys}
              filter={null}
              autoHighlight
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              value={targetKey}
              onValueChange={(key) => {
                if (typeof key === "string") setTargetKey(key);
                setPickerOpen(false);
              }}
            >
              <ComboboxTrigger
                aria-label="Project to link with"
                render={<SelectButton size="sm" className="w-full" />}
              >
                {target ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <ProjectFavicon project={target} className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">{target.displayName}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Choose a project</span>
                )}
              </ComboboxTrigger>
              <ComboboxPopup align="start" side="bottom" className="w-[var(--anchor-width)]">
                <ComboboxSearchInput
                  aria-label="Search projects"
                  placeholder="Search projects..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <ComboboxEmpty>No other projects.</ComboboxEmpty>
                <ComboboxList className="max-h-72">
                  {filtered.map((group, index) => (
                    <ComboboxItem
                      key={group.projectKey}
                      hideIndicator
                      index={index}
                      value={group.projectKey}
                    >
                      <ProjectFavicon project={group} className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm">{group.displayName}</span>
                      {/* Truncates from the start so the folder name stays visible. */}
                      <span
                        className="min-w-0 max-w-[60%] truncate text-xs text-muted-foreground"
                        dir="rtl"
                      >
                        <bdi>{describeGroupLocation(group)}</bdi>
                      </span>
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input
              aria-label="Linked project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!target || name.trim().length === 0 || isSubmitting} onClick={submit}>
            Link
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
