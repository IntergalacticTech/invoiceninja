export interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** Segmented toggle (aria-pressed buttons), as in the mock. */
export function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
