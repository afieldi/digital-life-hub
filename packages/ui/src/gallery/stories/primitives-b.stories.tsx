import { useState } from "react";
import { Button } from "../../primitives/Button";
import { Dialog, DialogTrigger, Modal } from "../../primitives/Dialog";
import {
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
} from "../../primitives/Menu";
import { Popover } from "../../primitives/Popover";
import { Tab, TabList, TabPanel, Tabs } from "../../primitives/Tabs";
import {
  addToast,
  createToastQueue,
  ToastRegion,
} from "../../primitives/Toast";
import { Tooltip, TooltipTrigger } from "../../primitives/Tooltip";
import { registerStories } from "../registry";
import { OverlayBox } from "./OverlayBox";

const noop = () => {};

function ToastDemo() {
  const [queue] = useState(() => {
    const q = createToastQueue();
    addToast(q, "Couldn't reach the server", "error");
    addToast(q, "Saved", "success");
    addToast(q, "Syncing in the background", "info");
    return q;
  });
  return (
    <OverlayBox height={260}>
      {() => (
        <ToastRegion
          queue={queue}
          className="absolute right-3 bottom-3 left-3 flex flex-col gap-2 outline-hidden"
        />
      )}
    </OverlayBox>
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
        {(c) => (
          <DialogTrigger isOpen onOpenChange={noop}>
            <Button className="m-4">Rename</Button>
            <Modal portalContainer={c} contained isDismissable={false}>
              <Dialog title="Rename card">
                <p className="text-sm text-ink-secondary">
                  Pick a name your future self will recognise.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" slot="close">
                    Cancel
                  </Button>
                  <Button variant="solid" slot="close">
                    Save
                  </Button>
                </div>
              </Dialog>
            </Modal>
          </DialogTrigger>
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
