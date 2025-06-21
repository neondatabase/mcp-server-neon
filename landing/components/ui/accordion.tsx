'use client';

import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDownIcon } from 'lucide-react';

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    {...props}
    style={{
      borderBottom: 'none',
    }}
  />
));
AccordionItem.displayName = 'AccordionItem';

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ children, ...props }, ref) => (
  <AccordionPrimitive.Header style={{ display: 'flex' }}>
    <AccordionPrimitive.Trigger
      ref={ref}
      {...props}
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 1rem',
        fontWeight: 500,
        transition: 'all 0.2s',
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {children}
      <ChevronDownIcon
        style={{
          width: '1rem',
          height: '1rem',
          transition: 'transform 0.2s',
        }}
      />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    {...props}
    style={{
      overflow: 'hidden',
      fontSize: '0.875rem',
      transition: 'all 0.2s',
      padding: '1rem',
      backgroundColor: 'var(--card)',
      border: '1px solid var(--border)',
      borderTop: 'none',
      borderRadius: '0 0 var(--radius-md) var(--radius-md)',
    }}
  >
    <div style={{ paddingBottom: '1rem' }}>{children}</div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
