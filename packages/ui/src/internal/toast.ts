import { UNSTABLE_ToastQueue as RACToastQueue } from "react-aria-components";

export type ToastTone = "info" | "success" | "error";
export type ToastContentValue = { message: string; tone: ToastTone };
export type ToastQueue = RACToastQueue<ToastContentValue>;

/** Own queue instance for galleries/tests. Not exported from the package index. */
export function createToastQueue(): ToastQueue {
  return new RACToastQueue<ToastContentValue>({ maxVisibleToasts: 5 });
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

export const toastClass = (tone: ToastTone) =>
  `glass-raised flex min-h-11 items-center gap-3 border py-2 pr-2 pl-4 font-ui text-sm text-ink-primary ${tones[tone]}`;
