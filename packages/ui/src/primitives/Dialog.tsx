import type { ReactNode } from "react";
import {
  DialogTrigger,
  Heading,
  ModalOverlay,
  type ModalOverlayProps,
  Dialog as RACDialog,
  type DialogProps as RACDialogProps,
  Modal as RACModal,
} from "react-aria-components";

export { DialogTrigger };

// Shared with the gallery, which renders the open state statically.
export const modalBackdropClass =
  "inset-0 z-50 flex items-center justify-center bg-[rgba(18,15,26,0.45)] backdrop-blur-[14px]";
export const modalPanelClass =
  "glass-dialog w-[min(28rem,calc(100vw-2rem))] outline-hidden";

export type ModalProps = Omit<
  ModalOverlayProps,
  "className" | "UNSTABLE_portalContainer" | "children"
> & {
  className?: string;
  children?: ReactNode;
  /** Render inside this element instead of document.body (gallery/screenshots). */
  portalContainer?: Element | null;
  /** Backdrop covers the portal container instead of the viewport. */
  contained?: boolean;
};

export function Modal({
  className,
  portalContainer,
  contained,
  children,
  ...props
}: ModalProps) {
  return (
    <ModalOverlay
      isDismissable
      {...props}
      UNSTABLE_portalContainer={portalContainer ?? undefined}
      className={`${contained ? "absolute" : "fixed"} ${modalBackdropClass}`}
    >
      <RACModal className={`${modalPanelClass} ${className ?? ""}`}>
        {children}
      </RACModal>
    </ModalOverlay>
  );
}

export type DialogProps = Omit<RACDialogProps, "className" | "children"> & {
  title?: string;
  className?: string;
  children?: ReactNode;
};

export function Dialog({ title, className, children, ...props }: DialogProps) {
  return (
    <RACDialog
      {...props}
      className={`flex flex-col gap-4 p-6 font-ui text-ink-primary outline-hidden ${className ?? ""}`}
    >
      {title ? (
        <Heading slot="title" className="font-serif text-2xl text-ink-primary">
          {title}
        </Heading>
      ) : null}
      {children}
    </RACDialog>
  );
}
