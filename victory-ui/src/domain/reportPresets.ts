import { addDays, weekStart } from './dates';

export type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_30' | 'this_year' | 'custom';

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const nextMonthStart = (ymd: string) => {
  const [y, m] = ymd.split('-').map(Number);
  const ny = (m ?? 1) === 12 ? (y ?? 1970) + 1 : y ?? 1970;
  const nm = (m ?? 1) === 12 ? 1 : (m ?? 1) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
};

export function presetRange(preset: Preset, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  switch (preset) {
    case 'this_week':
      return { from: weekStart(today), to: addDays(weekStart(today), 6) };
    case 'last_week':
      return { from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) };
    case 'this_month':
      return { from: monthStart(today), to: addDays(nextMonthStart(today), -1) };
    case 'last_month': {
      const thisStart = monthStart(today);
      return { from: monthStart(addDays(thisStart, -1)), to: addDays(thisStart, -1) };
    }
    case 'last_30':
      return { from: addDays(today, -29), to: today };
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  }
}

