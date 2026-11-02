import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
} from "react";

export type CaptureHighlight = { start: number; end: number };

export type CaptureFieldProps = {
  /** Accessible name of the input. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter (outside IME composition). */
  onSubmit: () => void;
  /** Ranges of `value` to mark, e.g. what a parser read. Must not overlap. */
  highlights?: CaptureHighlight[];
  placeholder?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
};

/** `value` split into plain and marked runs. */
function runs(
  value: string,
  highlights: CaptureHighlight[],
): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const h of [...highlights].sort((a, b) => a.start - b.start)) {
    if (h.start < at || h.end <= h.start) continue;
    if (h.start > at)
      out.push({ text: value.slice(at, h.start), marked: false });
    out.push({ text: value.slice(h.start, h.end), marked: true });
    at = h.end;
  }
  if (at < value.length) out.push({ text: value.slice(at), marked: false });
  return out;
}

const textClass = "font-ui text-[15px] leading-[22px]";

/**
 * A one-line capture input that marks ranges of what was typed. The marks sit
 * in a mirror of the text behind the transparent input, scrolled with it.
 */
export function CaptureField({
  label,
  value,
  onChange,
  onSubmit,
  highlights = [],
  placeholder,
  leading,
  trailing,
  inputRef,
}: CaptureFieldProps) {
  const own = useRef<HTMLInputElement | null>(null);
  const mirror = useRef<HTMLSpanElement>(null);
  const sync = () => {
    if (mirror.current && own.current) {
      mirror.current.scrollLeft = own.current.scrollLeft;
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync whenever the text changes.
  useLayoutEffect(sync, [value]);

  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) inputRef.current = el;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="glass-card flex min-h-14 items-center gap-3 rounded-14 pr-3 pl-[13px] focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-link/60">
      {leading}
      <span className="relative flex min-w-0 flex-1 items-center">
        <span
          ref={mirror}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-transparent ${textClass}`}
        >
          {runs(value, highlights).map((r, i) =>
            r.marked ? (
              <mark
                // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
                key={i}
                data-testid="capture-highlight"
                className="rounded-[4px] bg-check/35 text-transparent"
              >
                {r.text}
              </mark>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
              <span key={i}>{r.text}</span>
            ),
          )}
        </span>
        <input
          ref={setRef}
          type="text"
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={sync}
          onSelect={sync}
          className={`relative min-h-11 w-full min-w-0 border-0 bg-transparent p-0 text-ink-primary outline-hidden placeholder:text-ink-tertiary ${textClass}`}
        />
      </span>
      {trailing}
    </div>
  );
}
