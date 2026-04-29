import { Badge, stateBadgeTone } from './ui/Badge';

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={stateBadgeTone(state)}>{state}</Badge>;
}
