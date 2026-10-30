import {
  Tab as RACTab,
  TabList as RACTabList,
  type TabListProps as RACTabListProps,
  TabPanel as RACTabPanel,
  type TabPanelProps as RACTabPanelProps,
  type TabProps as RACTabProps,
  Tabs as RACTabs,
  type TabsProps as RACTabsProps,
} from "react-aria-components";
import { focusRing } from "./focus";

const join = (base: string, extra?: string) =>
  extra ? `${base} ${extra}` : base;

export type TabsProps = Omit<RACTabsProps, "className"> & {
  className?: string;
};
export function Tabs({ className, ...props }: TabsProps) {
  return (
    <RACTabs {...props} className={join("flex flex-col gap-3", className)} />
  );
}

export type TabListProps<T extends object> = Omit<
  RACTabListProps<T>,
  "className"
> & { className?: string };
export function TabList<T extends object>({
  className,
  ...props
}: TabListProps<T>) {
  return (
    <RACTabList
      {...props}
      className={join(
        "inline-flex w-fit gap-1 rounded-14 bg-[rgba(30,26,40,0.55)] p-1",
        className,
      )}
    />
  );
}

export type TabProps = Omit<RACTabProps, "className"> & { className?: string };
export function Tab({ className, ...props }: TabProps) {
  return (
    <RACTab
      {...props}
      className={join(
        `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-10 px-4 font-ui text-sm font-semibold text-ink-tertiary hovered:bg-white/10 hovered:text-ink-primary selected:bg-[rgba(255,255,255,0.18)] selected:text-ink-primary disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`,
        className,
      )}
    />
  );
}

export type TabPanelProps = Omit<RACTabPanelProps, "className"> & {
  className?: string;
};
export function TabPanel({ className, ...props }: TabPanelProps) {
  return (
    <RACTabPanel
      {...props}
      className={join(
        `font-ui text-ink-primary ${focusRing} rounded-10`,
        className,
      )}
    />
  );
}
