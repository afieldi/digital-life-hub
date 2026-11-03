import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternal } from "../src/shell/openExternal";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

test("in the desktop app a link opens through the opener plugin", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(openUrl).mockResolvedValue();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await openExternal("https://x.slack.com/archives/1");
  expect(openUrl).toHaveBeenCalledWith("https://x.slack.com/archives/1");
  expect(open).not.toHaveBeenCalled();
});

test("a link the opener refuses rejects", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(openUrl).mockRejectedValue(new Error("not allowed"));
  await expect(openExternal("https://example.com/a")).rejects.toThrow();
});

test("in the browser a link opens a new window", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await openExternal("https://example.com/a");
  expect(open).toHaveBeenCalledWith(
    "https://example.com/a",
    "_blank",
    "noopener",
  );
});
