import {
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as RACToastContent,
  UNSTABLE_ToastRegion as RACToastRegion,
} from "react-aria-components";
import {
  createToastQueue,
  type ToastAction,
  type ToastContentValue,
  type ToastQueue,
  type ToastTone,
  toastClass,
} from "../internal/toast";
import { Button } from "./Button";

export type { ToastAction, ToastContentValue, ToastQueue, ToastTone };

const queue = createToastQueue();

/** Show a toast in the mounted ToastRegion. Returns its key for closeToast. */
export function toast(
  message: string,
  opts: { tone?: ToastTone; timeout?: number; actions?: ToastAction[] } = {},
): string {
  return queue.add(
    { message, tone: opts.tone ?? "info", actions: opts.actions },
    { timeout: opts.timeout ?? 5000 },
  );
}

/** Close a toast shown with toast(). */
export function closeToast(key: string): void {
  queue.close(key);
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
          {t.content.actions?.map((a) => (
            <Button
              key={a.label}
              variant="ghost"
              onPress={() => {
                a.onAction();
                q.close(t.key);
              }}
            >
              {a.label}
            </Button>
          ))}
          <Button slot="close" variant="ghost" aria-label="Dismiss">
            ✕
          </Button>
        </RACToast>
      )}
    </RACToastRegion>
  );
}
