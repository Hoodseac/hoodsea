"use client";

interface Props {
  value: Date | null;
  onChange: (d: Date) => void;
  minDate?: Date;
}

function toInputValue(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimePicker({ value, onChange, minDate }: Props) {
  return (
    <input
      type="datetime-local"
      className="input-base"
      value={toInputValue(value)}
      min={minDate ? toInputValue(minDate) : undefined}
      onChange={(e) => {
        if (e.target.value) onChange(new Date(e.target.value));
      }}
      style={{ colorScheme: "dark" }}
    />
  );
}
