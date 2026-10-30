import { focusRing } from "../primitives/focus";

// Shared styling constants. Not exported from the package index.
export const modalBackdropClass =
  "inset-0 z-50 flex items-center justify-center bg-[rgba(18,15,26,0.45)] backdrop-blur-[14px]";
export const modalPanelClass =
  "glass-dialog w-[min(28rem,calc(100vw-2rem))] outline-hidden";

export const inputClass = `min-h-11 w-full rounded-14 border border-white/14 bg-white/8 px-4 font-ui text-ink-primary placeholder:text-ink-muted invalid:border-type-event disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;

export const dateInputClass =
  "flex min-h-11 w-full items-center rounded-14 border border-white/14 bg-white/8 px-4 font-ui text-ink-primary invalid:border-type-event focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-link data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
export const dateSegmentClass =
  "rounded-10 px-0.5 tabular-nums caret-transparent outline-hidden data-[placeholder]:text-ink-muted focus:bg-link focus:text-app data-[type=literal]:px-0";
