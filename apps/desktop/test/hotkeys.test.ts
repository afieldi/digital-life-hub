import { createHotkeys } from "../src/shell/hotkeys";

const key = (
  k: string,
  extra: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body,
) => {
  const e = new KeyboardEvent("keydown", { key: k, ...extra });
  Object.defineProperty(e, "target", { value: target });
  return e;
};

test("Ctrl+K opens on Windows, Cmd+K on macOS", () => {
  const win = vi.fn();
  const mac = vi.fn();
  createHotkeys({ platform: "Win32", onCommandBar: win, onGo() {} })(
    key("k", { ctrlKey: true }),
  );
  createHotkeys({ platform: "MacIntel", onCommandBar: mac, onGo() {} })(
    key("k", { metaKey: true }),
  );
  expect(win).toHaveBeenCalledOnce();
  expect(mac).toHaveBeenCalledOnce();
});

test("g then t navigates", () => {
  const go = vi.fn();
  const h = createHotkeys({
    platform: "MacIntel",
    onCommandBar() {},
    onGo: go,
  });
  h(key("g"));
  h(key("t"));
  expect(go).toHaveBeenCalledWith("t");
});

test("g t is ignored while typing in an input", () => {
  const go = vi.fn();
  const input = document.createElement("input");
  const h = createHotkeys({
    platform: "MacIntel",
    onCommandBar() {},
    onGo: go,
  });
  h(key("g", {}, input));
  h(key("t", {}, input));
  expect(go).not.toHaveBeenCalled();
});

test("mod+K still opens from inside an input", () => {
  const open = vi.fn();
  createHotkeys({ platform: "MacIntel", onCommandBar: open, onGo() {} })(
    key("k", { metaKey: true }, document.createElement("input")),
  );
  expect(open).toHaveBeenCalled();
});
