import { type ReactNode, useState } from "react";
import { Button } from "../../primitives/Button";
import {
  Dialog,
  DialogTrigger,
  modalBackdropClass,
  modalPanelClass,
} from "../../primitives/Dialog";
import {
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
} from "../../primitives/Menu";
import { Popover } from "../../primitives/Popover";
import { Tab, TabList, TabPanel, Tabs } from "../../primitives/Tabs";
import { toastClass } from "../../primitives/Toast";
import { Tooltip, TooltipTrigger } from "../../primitives/Tooltip";
import { registerStories } from "../registry";

const noop = () => {};

// The dialog story is static (the real Modal disables the rest of the page while
// open, which would break every other story); open/close behaviour is covered by
// the interaction tests. Menu/popover/tooltip use controlled isOpen with a no-op
// onOpenChange so outside pointer events from other stories can't close them.
// Overlays are portalled into this box (via each component's portalContainer
// prop) instead of document.body, so the open overlay lives inside the story's
// [data-story] element and is captured by its screenshot. `transform` makes the
// box the containing block for fixed/absolute children.
function OverlayBox({
  height = 280,
  children,
}: {
  height?: number;
  children: (container: HTMLDivElement) => ReactNode;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setEl}
      style={{ height, transform: "translateZ(0)" }}
      className="relative w-[440px] overflow-hidden rounded-18"
    >
      {el ? children(el) : null}
    </div>
  );
}

// RAC's ToastRegion always portals to document.body, so the story renders the
// same surface classes statically; queue behaviour is covered by the test.
function ToastDemo() {
  return (
    <div className="flex w-[360px] flex-col gap-2 p-4">
      <div className={toastClass("success")}>
        <span className="flex-1">Saved</span>
        <Button variant="ghost" aria-label="Dismiss">
          ✕
        </Button>
      </div>
      <div className={toastClass("error")}>
        <span className="flex-1">Couldn't reach the server</span>
        <Button variant="ghost" aria-label="Dismiss">
          ✕
        </Button>
      </div>
    </div>
  );
}

registerStories("primitives-b", [
  {
    id: "primitives/tabs",
    title: "Tabs",
    render: () => (
      <div className="p-6">
        <Tabs defaultSelectedKey="list">
          <div data-force-focus>
            <TabList aria-label="Views">
              <Tab id="board">Board</Tab>
              <Tab id="list">List</Tab>
              <Tab id="calendar">Calendar</Tab>
            </TabList>
          </div>
          <TabPanel id="board">Board view</TabPanel>
          <TabPanel id="list">List view</TabPanel>
          <TabPanel id="calendar">Calendar view</TabPanel>
        </Tabs>
      </div>
    ),
  },
  {
    id: "primitives/menu",
    title: "Menu (open)",
    render: () => (
      <OverlayBox>
        {(c) => (
          <div className="p-4">
            <MenuTrigger isOpen onOpenChange={noop}>
              <Button>Actions</Button>
              <Menu
                portalContainer={c}
                popoverProps={{
                  isNonModal: true,
                  className: "max-h-none!",
                  shouldFlip: false,
                  placement: "bottom start",
                }}
                aria-label="Actions"
              >
                <MenuSection title="Card">
                  <MenuItem id="rename">Rename</MenuItem>
                  <MenuItem id="duplicate">Duplicate</MenuItem>
                </MenuSection>
                <MenuSection title="Danger">
                  <MenuItem id="delete">Delete</MenuItem>
                </MenuSection>
              </Menu>
            </MenuTrigger>
          </div>
        )}
      </OverlayBox>
    ),
  },
  {
    id: "primitives/popover",
    title: "Popover (open)",
    render: () => (
      <OverlayBox height={200}>
        {(c) => (
          <div className="p-4">
            <DialogTrigger isOpen onOpenChange={noop}>
              <Button>Details</Button>
              <Popover
                className="max-h-none!"
                portalContainer={c}
                isNonModal
                shouldFlip={false}
                placement="bottom start"
              >
                <Dialog aria-label="Details" className="w-64 p-4">
                  <p className="text-sm">Due Friday. Shared with 2 people.</p>
                </Dialog>
              </Popover>
            </DialogTrigger>
          </div>
        )}
      </OverlayBox>
    ),
  },
  {
    id: "primitives/dialog",
    title: "Dialog (open)",
    render: () => (
      <OverlayBox height={320}>
        {() => (
          <div className="p-4">
            <Button>Rename</Button>
            <div className={`absolute ${modalBackdropClass}`}>
              <div className={modalPanelClass}>
                <Dialog title="Rename card" aria-label="Rename card">
                  <p className="text-sm text-ink-secondary">
                    Pick a name your future self will recognise.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost">Cancel</Button>
                    <Button variant="solid">Save</Button>
                  </div>
                </Dialog>
              </div>
            </div>
          </div>
        )}
      </OverlayBox>
    ),
  },
  {
    id: "primitives/tooltip",
    title: "Tooltip (open)",
    render: () => (
      <OverlayBox height={140}>
        {(c) => (
          <div className="p-4 pt-12">
            <TooltipTrigger isOpen onOpenChange={noop}>
              <Button variant="icon" aria-label="Settings">
                ⚙
              </Button>
              <Tooltip
                className="max-h-none!"
                portalContainer={c}
                shouldFlip={false}
                placement="bottom"
              >
                Settings
              </Tooltip>
            </TooltipTrigger>
          </div>
        )}
      </OverlayBox>
    ),
  },
  { id: "primitives/toast", title: "Toast", render: () => <ToastDemo /> },
]);
