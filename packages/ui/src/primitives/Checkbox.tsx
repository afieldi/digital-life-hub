import {
  type CheckboxProps,
  Checkbox as RACCheckbox,
} from "react-aria-components";
import { focusRing } from "./focus";

export type { CheckboxProps };

export function Checkbox({
  children,
  ...props
}: Omit<CheckboxProps, "className">) {
  return (
    <RACCheckbox
      {...props}
      className="group inline-flex min-h-11 cursor-pointer items-center gap-3 font-ui text-ink-primary disabled:cursor-not-allowed disabled:opacity-45"
    >
      {(renderProps) => (
        <>
          <span
            aria-hidden="true"
            className={`flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] text-sm font-bold leading-none ${
              renderProps.isSelected || renderProps.isIndeterminate
                ? "border-check bg-check text-app"
                : "border-ink-muted bg-transparent text-transparent"
            } ${renderProps.isFocusVisible ? "outline-2 outline-offset-2 outline-link" : ""} ${focusRing}`}
          >
            {renderProps.isIndeterminate
              ? "–"
              : renderProps.isSelected
                ? "✓"
                : ""}
          </span>
          {typeof children === "function" ? children(renderProps) : children}
        </>
      )}
    </RACCheckbox>
  );
}
