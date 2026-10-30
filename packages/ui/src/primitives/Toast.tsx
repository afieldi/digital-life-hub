import {
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as RACToastContent,
  UNSTABLE_ToastRegion as RACToastRegion,
} from "react-aria-components";
import {
  createToastQueue,
  type ToastContentValue,
  type ToastQueue,
  type ToastTone,
  toastClass,
} from "../internal/toast";
import { Button } from "./Button";

export type { ToastContentValue, ToastQueue, ToastTone };

const queue = createToastQueue();

/** Show a toast in the mounted ToastRegion. */
export function toast(
  message: string,
  opts: { tone?: ToastTone; timeout?: number } = {},
): void {
  queue.add(
    { message, tone: opts.tone ?? "info" },
    { timeout: opts.timeout ?? 5000 },
  );
}

export function ToastRegion({
  /** @internal gallery only */
  queue: q = queue,
  className,
}: {
  queue?: ToastQueue;
  className?: string;
}) {
  return (
    <RACToastRegion
      queue={q}
      className={
        className ??
        "fixed right-4 bottom-4 z-50 flex flex-col gap-2 outline-hidden"
      }
    >
      {({ toast: t }) => (
        <RACToast toast={t} className={toastClass(t.content.tone)}>
          <RACToastContent role="status" className="flex-1">
            {t.content.message}
          </RACToastContent>
          <Button slot="close" variant="ghost" aria-label="Dismiss">
            ✕
          </Button>
        </RACToast>
      )}
    </RACToastRegion>
  );
}
