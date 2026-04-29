import { Skeleton } from '../ui/Skeleton';

export function ProposalListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-full max-w-72" />
        <Skeleton className="ml-auto h-4 w-20 sm:w-24" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-4 sm:px-5 lg:grid lg:grid-cols-[80px_minmax(0,1fr)_240px_220px_120px] lg:items-center lg:gap-5"
          >
            <div className="flex items-center justify-between lg:contents">
              <Skeleton className="h-4 w-12 lg:order-1" />
              <Skeleton className="h-6 w-20 rounded-md lg:order-5 lg:justify-self-end" />
            </div>
            <div className="flex flex-col gap-2 lg:order-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex flex-col gap-1.5 lg:order-3">
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-full lg:w-40 lg:order-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
