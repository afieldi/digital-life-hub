import { Switch as RACSwitch, type SwitchProps } from "react-aria-components";

export type { SwitchProps };

export function Switch({ children, ...props }: Omit<SwitchProps, "className">) {
  return (
    <RACSwitch
      {...props}
      className="group inline-flex min-h-11 cursor-pointer items-center gap-3 font-ui text-ink-primary disabled:cursor-not-allowed disabled:opacity-45"
    >
      {(renderProps) => (
        <>
          <span
            aria-hidden="true"
            className={`flex h-[26px] w-[44px] shrink-0 items-center rounded-full border border-white/14 px-[3px] transition-colors ${
              renderProps.isSelected ? "bg-check" : "bg-white/12"
            } ${renderProps.isFocusVisible ? "outline-2 outline-offset-2 outline-link" : ""}`}
          >
            <span
              className={`size-5 rounded-full bg-white shadow transition-transform ${
                renderProps.isSelected ? "translate-x-[18px]" : "translate-x-0"
              }`}
            />
          </span>
          {typeof children === "function" ? children(renderProps) : children}
        </>
      )}
    </RACSwitch>
  );
}
