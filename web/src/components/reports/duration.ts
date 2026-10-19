import { toDateInput } from '@/lib/format';

/** Duration presets understood by `DurationScopeTrait::scopeAdvanceDuration` (backend). */
export const DURATION_PRESETS = [
  { value: 'today', label: 'Today', hint: 'Includes records from today.' },
  { value: 'yesterday', label: 'Yesterday', hint: 'Includes records from yesterday.' },
  { value: 'weekly', label: 'This week', hint: 'Includes records from this week.' },
  { value: 'last_seven_days', label: 'Last 7 days', hint: 'Includes records from the last 7 days.' },
  { value: 'last_work_week', label: 'Last work week', hint: 'Includes records from the last work week.' },
  { value: 'last_biweek', label: 'Last biweek', hint: 'Includes records from the last biweek.' },
  { value: 'monthly', label: 'This month', hint: 'Includes records from this month.' },
  { value: 'last_month', label: 'Last month', hint: 'Includes records from last month.' },
  { value: 'last_three_months', label: 'Last 3 months', hint: 'Includes records from the last 3 months.' },
  { value: 'last_quarter', label: 'Last quarter', hint: 'Includes records from the last quarter.' },
  { value: 'last_six_months', label: 'Last 6 months', hint: 'Includes records from the last 6 months.' },
  { value: 'last_biannual', label: 'Last biannual', hint: 'Includes records from the last biannual period.' },
  { value: 'yearly', label: 'This year', hint: 'Includes records from this year.' },
  { value: 'last_year', label: 'Last year', hint: 'Includes records from last year.' },
  { value: 'custom', label: 'Custom', hint: 'Select a custom date range.' },
] as const;

export type DurationValue = '' | (typeof DURATION_PRESETS)[number]['value'];

export type DurationFilter = {
  duration: DurationValue;
  starting_date: string;
  starting_time: string;
  ending_date: string;
  ending_time: string;
};

export const emptyDuration: DurationFilter = {
  duration: '',
  starting_date: '',
  starting_time: '',
  ending_date: '',
  ending_time: '',
};

/**
 * Query params for the report endpoints.
 *
 * The backend resolves `weekly`, `monthly` and `yearly` relative to `starting_date` and falls back to
 * the Unix epoch when it is missing (so "This month" would mean January 1970). We therefore always
 * anchor those presets on today's date.
 */
export function durationParams(f: DurationFilter): Record<string, string | undefined> {
  if (!f.duration) return {};
  if (f.duration === 'custom') {
    return {
      duration: 'custom',
      starting_date: f.starting_date || undefined,
      starting_time: f.starting_date && f.starting_time ? f.starting_time : undefined,
      ending_date: f.ending_date || undefined,
      ending_time: f.ending_date && f.ending_time ? f.ending_time : undefined,
    };
  }
  if (f.duration === 'weekly' || f.duration === 'monthly' || f.duration === 'yearly') {
    const today = toDateInput();
    return { duration: f.duration, starting_date: today, ending_date: today };
  }
  return { duration: f.duration };
}

export function durationLabel(f: DurationFilter, t: (k: string) => string): string {
  if (!f.duration) return t('All time');
  if (f.duration === 'custom') {
    const from = [f.starting_date, f.starting_time].filter(Boolean).join(' ');
    const to = [f.ending_date, f.ending_time].filter(Boolean).join(' ');
    return `${from || '…'} → ${to || t('Today')}`;
  }
  const p = DURATION_PRESETS.find((d) => d.value === f.duration);
  return p ? t(p.label) : f.duration;
}

export const MONTH_KEYS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
