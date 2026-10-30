import type { ReactNode } from "react";
import {
  Header,
  MenuTrigger,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  type MenuItemProps as RACMenuItemProps,
  type MenuProps as RACMenuProps,
  MenuSection as RACMenuSection,
  type MenuSectionProps as RACMenuSectionProps,
} from "react-aria-components";
import { Popover, type PopoverProps } from "./Popover";

export { MenuTrigger };

export type MenuProps<T extends object> = Omit<RACMenuProps<T>, "className"> & {
  className?: string;
  portalContainer?: Element | null;
  /** Extra Popover props (placement, isNonModal, boundaryElement…), for the gallery. */
  popoverProps?: Omit<PopoverProps, "children">;
};

export function Menu<T extends object>({
  className,
  portalContainer,
  popoverProps,
  ...props
}: MenuProps<T>) {
  return (
    <Popover
      {...popoverProps}
      portalContainer={portalContainer}
      className={`p-1.5${popoverProps?.className ? ` ${popoverProps.className}` : ""}`}
    >
      <RACMenu
        {...props}
        className={`flex max-h-80 flex-col gap-0.5 overflow-auto outline-hidden${className ? ` ${className}` : ""}`}
      />
    </Popover>
  );
}

export type MenuItemProps = Omit<RACMenuItemProps, "className"> & {
  className?: string;
};

export function MenuItem({ className, ...props }: MenuItemProps) {
  return (
    <RACMenuItem
      {...props}
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-10 px-3 font-ui text-sm text-ink-primary outline-hidden focused:bg-white/15 pressed:bg-white/20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-45${className ? ` ${className}` : ""}`}
    />
  );
}

export type MenuSectionProps<T extends object> = Omit<
  RACMenuSectionProps<T>,
  "className" | "children"
> & { title?: string; className?: string; children?: ReactNode };

export function MenuSection<T extends object>({
  title,
  className,
  children,
  ...props
}: MenuSectionProps<T>) {
  return (
    <RACMenuSection
      {...props}
      className={`flex flex-col gap-0.5${className ? ` ${className}` : ""}`}
    >
      {title ? (
        <Header className="px-3 pt-2 pb-1 font-ui text-xs uppercase tracking-widest text-ink-muted">
          {title}
        </Header>
      ) : null}
      {children}
    </RACMenuSection>
  );
}
