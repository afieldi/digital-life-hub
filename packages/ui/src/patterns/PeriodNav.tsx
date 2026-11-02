import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../primitives/Button";

export type PeriodNavProps = {
  /** The period shown, like "Nov 2 – 8". */
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  /** Accessible names of the arrows, like "Previous week". */
  previousLabel: string;
  nextLabel: string;
};

/** ‹ Nov 2 – 8 ›: steps through weeks (or any period) one at a time. */
export function PeriodNav({
  label,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
}: PeriodNavProps) {
  return (
    <div className="flex items-center gap-2 font-ui text-ink-primary">
      <Button variant="icon" aria-label={previousLabel} onPress={onPrevious}>
        <ChevronLeft aria-hidden="true" size={18} />
      </Button>
      <h2
        aria-live="polite"
        className="min-w-[9ch] text-center text-lg font-semibold"
      >
        {label}
      </h2>
      <Button variant="icon" aria-label={nextLabel} onPress={onNext}>
        <ChevronRight aria-hidden="true" size={18} />
      </Button>
    </div>
  );
}
