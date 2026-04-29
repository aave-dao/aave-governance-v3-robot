type Props = { state: string };

export function StateBadge({ state }: Props) {
  const cls = state.toLowerCase();
  return <span className={`state-badge ${cls}`}>{state}</span>;
}
