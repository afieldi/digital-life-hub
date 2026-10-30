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
import { modalBackdropClass, modalPanelClass } from "../internal/classes";

export { DialogTrigger };

export type ModalProps = Omit<ModalOverlayProps, "className" | "children"> & {
  className?: string;
  children?: ReactNode;
  /**
   * Backdrop covers its portal container instead of the viewport.
   * @internal gallery only
   */
  contained?: boolean;
};

export function Modal({
  className,
  contained,
  children,
  ...props
}: ModalProps) {
  return (
    <ModalOverlay
      isDismissable
      {...props}
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
