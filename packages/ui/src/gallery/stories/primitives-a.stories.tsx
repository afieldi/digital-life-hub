import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "../../primitives/Button";
import { Checkbox } from "../../primitives/Checkbox";
import { SearchField } from "../../primitives/SearchField";
import { Switch } from "../../primitives/Switch";
import { TextField } from "../../primitives/TextField";
import { registerStories } from "../registry";

// Static stories cover default and disabled; hover/pressed/focus are runtime
// states React Aria owns and are exercised by the interaction tests.
const forced = { default: {}, disabled: { isDisabled: true } } as const;
type State = keyof typeof forced;
const states = Object.keys(forced) as State[];

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 p-6">{children}</div>
  );
}

const variants: ButtonVariant[] = ["solid", "glass", "ghost", "dashed", "icon"];

registerStories("primitives", [
  ...variants.map((variant) => ({
    id: `primitives/button-${variant}`,
    title: `Button ${variant}`,
    render: () => (
      <Row>
        {states.map((s) =>
          variant === "icon" ? (
            <Button
              key={s}
              variant="icon"
              aria-label={`Settings (${s})`}
              {...forced[s]}
            >
              ⚙
            </Button>
          ) : (
            <Button key={s} variant={variant} {...forced[s]}>
              {variant === "dashed" ? "+ Add card" : `Button ${s}`}
            </Button>
          ),
        )}
      </Row>
    ),
  })),
  {
    id: "primitives/checkbox",
    title: "Checkbox",
    render: () => (
      <Row>
        <Checkbox>Unchecked</Checkbox>
        <Checkbox defaultSelected>Checked</Checkbox>
        <Checkbox isIndeterminate>Indeterminate</Checkbox>
        <Checkbox isDisabled>Disabled</Checkbox>
        <Checkbox defaultSelected isDisabled>
          Disabled checked
        </Checkbox>
      </Row>
    ),
  },
  {
    id: "primitives/textfield",
    title: "TextField",
    render: () => (
      <Row>
        <TextField
          label="Title"
          placeholder="Name this card"
          className="w-64"
        />
        <TextField
          label="With value"
          defaultValue="Plan vendor visit"
          description="Shown on the card"
          className="w-64"
        />
        <TextField
          label="Invalid"
          isInvalid
          defaultValue=""
          errorMessage="Required"
          className="w-64"
        />
        <TextField
          label="Disabled"
          isDisabled
          defaultValue="Locked"
          className="w-64"
        />
      </Row>
    ),
  },
  {
    id: "primitives/searchfield",
    title: "SearchField",
    render: () => (
      <Row>
        <SearchField
          label="Search"
          placeholder="Search…"
          shortcut="⌘K"
          className="w-72"
        />
        <SearchField label="Search" defaultValue="vendor" className="w-72" />
        <SearchField
          label="Search"
          isDisabled
          placeholder="Search…"
          className="w-72"
        />
      </Row>
    ),
  },
  {
    id: "primitives/switch",
    title: "Switch",
    render: () => (
      <Row>
        <Switch>Off</Switch>
        <Switch defaultSelected>On</Switch>
        <Switch isDisabled>Disabled</Switch>
        <Switch defaultSelected isDisabled>
          Disabled on
        </Switch>
      </Row>
    ),
  },
]);
