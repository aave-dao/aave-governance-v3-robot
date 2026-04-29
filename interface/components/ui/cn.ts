// tiny clsx wrapper, kept here so we don't have to import from `clsx` everywhere.
import clsx, { type ClassValue } from 'clsx';

export const cn = (...args: ClassValue[]): string => clsx(...args);
