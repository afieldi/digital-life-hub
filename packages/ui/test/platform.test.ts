import { isTextEntry } from "../src/platform";

describe("isTextEntry", () => {
  const input = (type: string) =>
    Object.assign(document.createElement("input"), { type });

  test("text fields, selects and editable regions take typing", () => {
    expect(isTextEntry(input("text"))).toBe(true);
    expect(isTextEntry(input("search"))).toBe(true);
    expect(isTextEntry(document.createElement("textarea"))).toBe(true);
    expect(isTextEntry(document.createElement("select"))).toBe(true);
    const region = document.createElement("div");
    region.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    region.append(inner);
    document.body.append(region);
    expect(isTextEntry(inner)).toBe(true);
    region.remove();
  });

  test("checkboxes, radios, buttons and plain elements don't", () => {
    for (const type of ["checkbox", "radio", "button", "submit"]) {
      expect(isTextEntry(input(type)), type).toBe(false);
    }
    expect(isTextEntry(document.createElement("button"))).toBe(false);
    expect(isTextEntry(document.createElement("a"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
