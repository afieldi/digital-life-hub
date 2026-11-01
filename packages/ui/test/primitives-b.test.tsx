import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../src/primitives/Button";
import { Dialog, DialogTrigger, Modal } from "../src/primitives/Dialog";
import { Menu, MenuItem, MenuTrigger } from "../src/primitives/Menu";
import { Tab, TabList, TabPanel, Tabs } from "../src/primitives/Tabs";
import { closeToast, ToastRegion, toast } from "../src/primitives/Toast";

test("Tabs move with arrow keys", async () => {
  render(
    <Tabs>
      <TabList aria-label="Views">
        <Tab id="a">Board</Tab>
        <Tab id="b">List</Tab>
        <Tab id="c">Calendar</Tab>
      </TabList>
      <TabPanel id="a">Board panel</TabPanel>
      <TabPanel id="b">List panel</TabPanel>
      <TabPanel id="c">Calendar panel</TabPanel>
    </Tabs>,
  );
  const first = screen.getByRole("tab", { name: "Board" });
  const second = screen.getByRole("tab", { name: "List" });
  first.focus();
  expect(first).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowRight}");
  expect(second).toHaveAttribute("aria-selected", "true");
  expect(first).toHaveAttribute("aria-selected", "false");
});

test("Dialog closes on Escape and returns focus to the trigger", async () => {
  render(
    <DialogTrigger>
      <Button>Open</Button>
      <Modal>
        <Dialog title="Rename">
          <p>Body</p>
        </Dialog>
      </Modal>
    </DialogTrigger>,
  );
  const trigger = screen.getByRole("button", { name: "Open" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Rename" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // React Aria restores focus on the next frame.
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("Menu item fires onAction from keyboard", async () => {
  const onAction = vi.fn();
  render(
    <MenuTrigger>
      <Button>Actions</Button>
      <Menu onAction={onAction}>
        <MenuItem id="rename">Rename</MenuItem>
        <MenuItem id="delete">Delete</MenuItem>
      </Menu>
    </MenuTrigger>,
  );
  const trigger = screen.getByRole("button", { name: "Actions" });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("menu");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Enter}");
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(["rename", "delete"]).toContain(onAction.mock.calls[0]?.[0]);
});

test("toast() renders a status message", async () => {
  render(<ToastRegion />);
  act(() => toast("Saved"));
  const status = await screen.findByText("Saved");
  expect(status.closest('[role="status"]')).not.toBeNull();
});

test("toast actions call onAction and close the toast", async () => {
  const onAction = vi.fn();
  render(<ToastRegion />);
  act(() => {
    toast("Deleted", { actions: [{ label: "Undo", onAction }] });
  });
  await screen.findByText("Deleted");
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onAction).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByText("Deleted")).toBeNull());
});

test("closeToast removes the toast by key", async () => {
  render(<ToastRegion />);
  let key = "";
  act(() => {
    key = toast("Working");
  });
  await screen.findByText("Working");
  act(() => closeToast(key));
  await waitFor(() => expect(screen.queryByText("Working")).toBeNull());
});

test("toast actions fire once on rapid double press", async () => {
  const onAction = vi.fn();
  render(<ToastRegion />);
  act(() => {
    toast("Gone", { actions: [{ label: "Undo", onAction }] });
  });
  const btn = await screen.findByRole("button", { name: "Undo" });
  await userEvent.dblClick(btn);
  expect(onAction).toHaveBeenCalledOnce();
});

test("closeToast with an unknown key does not throw", () => {
  expect(() => closeToast("unknown")).not.toThrow();
});
