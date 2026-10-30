import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "../../primitives/Button";
import { Checkbox } from "../../primitives/Checkbox";
import { SearchField } from "../../primitives/SearchField";
import { Switch } from "../../primitives/Switch";
import { TextField } from "../../primitives/TextField";
import { registerStories } from "../registry";

// Focus, hover and pressed are real, not faked: a story marks one element with
// data-force-focus / data-force-hover / data-force-press and the screenshot spec
// keyboard-focuses it, hovers it, or hovers + holds the mouse down on it before
// capturing, so React Aria's own state attributes and the focus-visible
// pseudo-class genuinely match. One element per story, because only one can hold
// focus or the pointer at a time.
const forced = {
  default: {},
  focus: {},
  disabled: { isDisabled: true },
} as const;
type State = keyof typeof forced;
const states = Object.keys(forced) as State[];

function Focus({ children }: { children: ReactNode }) {
  return <span data-force-focus>{children}</span>;
}
const wrap = (s: State, node: ReactNode) =>
  s === "focus" ? <Focus key={s}>{node}</Focus> : node;

function Hover({ children }: { children: ReactNode }) {
  return <span data-force-hover>{children}</span>;
}
function Press({ children }: { children: ReactNode }) {
  return <span data-force-press>{children}</span>;
}

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
          wrap(
            s,
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
          ),
        )}
      </Row>
    ),
  })),
  ...variants.flatMap((variant) =>
    (["hover", "pressed"] as const).map((state) => {
      const Mark = state === "hover" ? Hover : Press;
      return {
        id: `primitives/button-${variant}-${state}`,
        title: `Button ${variant} ${state}`,
        render: () => (
          <Row>
            <Mark>
              {variant === "icon" ? (
                <Button variant="icon" aria-label={`Settings (${state})`}>
                  ⚙
                </Button>
              ) : (
                <Button variant={variant}>
                  {variant === "dashed" ? "+ Add card" : `Button ${state}`}
                </Button>
              )}
            </Mark>
          </Row>
        ),
      };
    }),
  ),
  {
    id: "primitives/checkbox",
    title: "Checkbox",
    render: () => (
      <Row>
        <Checkbox>Unchecked</Checkbox>
        <Checkbox defaultSelected>Checked</Checkbox>
        <Focus>
          <Checkbox>Focused</Checkbox>
        </Focus>
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
    id: "primitives/textfield-focus",
    title: "TextField focus",
    render: () => (
      <Row>
        <Focus>
          <TextField
            label="Title"
            placeholder="Name this card"
            className="w-64"
          />
        </Focus>
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
    id: "primitives/searchfield-focus",
    title: "SearchField focus",
    render: () => (
      <Row>
        <Focus>
          <SearchField
            label="Search"
            placeholder="Search…"
            shortcut="⌘K"
            className="w-72"
          />
        </Focus>
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
        <Focus>
          <Switch>Focused</Switch>
        </Focus>
        <Switch isDisabled>Disabled</Switch>
        <Switch defaultSelected isDisabled>
          Disabled on
        </Switch>
      </Row>
    ),
  },
]);
