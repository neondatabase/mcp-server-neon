import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        important:
          'border-important-notes-50 text-important-notes dark:border-important-notes',
        destructive:
          'border-destructive-50 text-destructive dark:border-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type AlertVariant = VariantProps<typeof alertVariants>['variant'];

export function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <div className="flex items-start gap-3">
        {children}
      </div>
    </div>
  );
}

export function AlertTitle({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'py-1 mb-1 font-medium leading-none tracking-tight flex-1',
        className,
      )}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('text-sm leading-relaxed', className)}
      {...props}
    />
  );
}
