import {
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as RACToastContent,
  UNSTABLE_ToastQueue as RACToastQueue,
  UNSTABLE_ToastRegion as RACToastRegion,
} from "react-aria-components";
import { Button } from "./Button";

export type ToastTone = "info" | "success" | "error";
export type ToastContentValue = { message: string; tone: ToastTone };
export type ToastQueue = RACToastQueue<ToastContentValue>;

/** Create a queue (own instance for galleries/tests; apps use the shared one via toast()). */
export function createToastQueue(): ToastQueue {
  return new RACToastQueue<ToastContentValue>({ maxVisibleToasts: 5 });
}

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

/** Add a toast that stays until dismissed, to a specific queue. */
export function addToast(
  target: ToastQueue,
  message: string,
  tone: ToastTone = "info",
): void {
  target.add({ message, tone });
}

const tones: Record<ToastTone, string> = {
  info: "border-white/16",
  success: "border-type-task",
  error: "border-type-event",
};

/** Toast surface classes, shared with the gallery's static rendering. */
export const toastClass = (tone: ToastTone) =>
  `glass-raised flex min-h-11 items-center gap-3 border py-2 pr-2 pl-4 font-ui text-sm text-ink-primary ${tones[tone]}`;

export function ToastRegion({
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
