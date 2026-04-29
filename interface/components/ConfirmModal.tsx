'use client';

import type { ReactNode } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  details?: Array<{ label: string; value: ReactNode }>;
  confirmLabel?: string;
  variant?: 'primary' | 'danger' | 'success';
  loading?: boolean;
};

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  variant = 'primary',
  loading,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={variant} size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {details && details.length > 0 && (
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 gap-x-4 text-[12px]">
          {details.map((d, i) => (
            <div key={i} className="contents">
              <dt className="text-fg-dim">{d.label}</dt>
              <dd className="font-mono text-fg break-all">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}
