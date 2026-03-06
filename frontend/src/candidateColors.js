export const CANDIDATE_COLORS = [
  '#3b82f6',
  '#f97316',
  '#16a34a',
  '#e11d48',
  '#6d28d9',
  '#0891b2',
  '#ca8a04',
  '#15803d',
];

export function colorForIndex(index) {
  return CANDIDATE_COLORS[index % CANDIDATE_COLORS.length];
}
