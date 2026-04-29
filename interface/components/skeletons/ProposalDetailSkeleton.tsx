import { Skeleton } from '../ui/Skeleton';

export function ProposalDetailSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}
