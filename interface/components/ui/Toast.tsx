'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Check, X, AlertCircle, Info } from 'lucide-react';
import { cn } from './cn';

type ToastVariant = 'success' | 'error' | 'info';

type ToastEntry = {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: ReactNode;
};

type ToastApi = {
  show: (variant: ToastVariant, title: string, description?: ReactNode) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: ReactNode) => string;
  error: (title: string, description?: ReactNode) => string;
  info: (title: string, description?: ReactNode) => string;
};

const ToastCtx = createContext<ToastApi | null>(null);

const TIMEOUT = 6000;
const MAX_STACK = 5;

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (variant: ToastVariant, title: string, description?: ReactNode): string => {
      const id = `t-${Date.now()}-${counter++}`;
      setItems((cur) => {
        const next = [...cur, { id, variant, title, description }];
        return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
      });
      return id;
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, desc) => show('success', title, desc),
      error: (title, desc) => show('error', title, desc),
      info: (title, desc) => show('info', title, desc),
    }),
    [show, dismiss],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <ToastItem key={t.id} entry={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(entry.id), TIMEOUT);
    return () => clearTimeout(t);
  }, [entry.id, onDismiss]);

  const tone =
    entry.variant === 'success'
      ? 'border-success-border bg-success-bg text-success'
      : entry.variant === 'error'
        ? 'border-danger-border bg-danger-bg text-danger'
        : 'border-accent-border bg-accent-bg text-accent';

  const Icon =
    entry.variant === 'success'
      ? Check
      : entry.variant === 'error'
        ? AlertCircle
        : Info;

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-md border bg-surface-elev px-3.5 py-3 shadow-xl backdrop-blur',
        'anim-slide',
        'border-border-strong',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-5 w-5 place-items-center rounded-full border',
          tone,
        )}
      >
        <Icon size={12} strokeWidth={2.5} />
      </span>
      <div className="flex-1 text-[13px]">
        <div className="font-semibold leading-snug text-fg">{entry.title}</div>
        {entry.description && (
          <div className="mt-0.5 text-[12px] leading-snug text-fg-muted">{entry.description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(entry.id)}
        aria-label="Dismiss"
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-fg-dim transition-colors hover:bg-surface hover:text-fg"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// SSR / standalone fallback — `useToast` should never throw because that crashes the page
// render. Toasts are client-only anyway; the no-op lets the provider mount, after which
// real toasts will work. (Each call returns a different but stable `id` to avoid surprises.)
const NOOP_API: ToastApi = {
  show: () => 'noop',
  dismiss: () => {},
  success: () => 'noop',
  error: () => 'noop',
  info: () => 'noop',
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  return ctx ?? NOOP_API;
}
