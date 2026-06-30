import { Badge } from '@/components/ui/Badge';

/** Render the markets that share a feed as small chips. V4 spokes get the accent tone so
 *  the hub/spoke listings stand out from the V3 markets. */
export function MarketTags({ tags, size = 'xs' }: { tags: string[]; size?: 'xs' | 'sm' }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <Badge key={t} size={size} tone={t.startsWith('V4') ? 'accent' : 'neutral'}>
          {t}
        </Badge>
      ))}
    </span>
  );
}
