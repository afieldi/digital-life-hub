import { Label, ProgressBar as RACProgressBar } from "react-aria-components";

export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  return (
    <RACProgressBar
      value={value}
      minValue={0}
      maxValue={max}
      valueLabel={`${value} of ${max} done`}
      className="flex w-full flex-col gap-1.5 font-ui"
    >
      {({ percentage, valueText }) => (
        <>
          <div className="flex justify-between text-xs">
            <Label className="text-ink-secondary">{label}</Label>
            <span className="text-ink-tertiary">{valueText}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/14">
            <div
              className="h-full rounded-full bg-check"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </>
      )}
    </RACProgressBar>
  );
}
