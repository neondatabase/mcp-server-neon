import {
  DescriptionItem,
  DescriptionItemType,
  TextBlock,
} from '@/lib/description';
import { CodeSnippet } from '@/components/CodeSnippet';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AlertVariant,
} from '@/components/ui/alert';
import {
  Terminal,
  CircleAlert,
  Workflow,
  SquareArrowRight,
  Component,
  BookOpenCheck,
} from 'lucide-react';

const ALERT_VARIANT_PER_DESCRIPTION_TYPE: Record<
  DescriptionItemType,
  {
    variant: AlertVariant;
    icon: typeof Component;
  }
> = {
  use_case: { variant: 'default', icon: BookOpenCheck },
  next_steps: { variant: 'default', icon: SquareArrowRight },
  important_notes: { variant: 'important', icon: CircleAlert },
  workflow: { variant: 'default', icon: Workflow },
  instructions: { variant: 'default', icon: Terminal },
  response_instructions: { variant: 'default', icon: Terminal },
  example: { variant: 'default', icon: Terminal },
  do_not_include: { variant: 'destructive', icon: CircleAlert },
  error_handling: { variant: 'destructive', icon: CircleAlert },
};

export const TextBlockUi = (block: TextBlock) => {
  if (block.type === 'text') {
    return (
      <div>
        {block.content.map((item, index) =>
          item.type === 'text' ? (
            item.content
          ) : (
            <span key={index} className="monospaced bg-secondary p-1">
              {item.content}
            </span>
          ),
        )}
      </div>
    );
  }

  return <CodeSnippet type={block.syntax}>{block.content}</CodeSnippet>;
};

export const DescriptionItemUi = ({ type, content }: DescriptionItem) => {
  if (type === 'text') {
    return (
      <div className="whitespace-pre-line">
        {content.map((item, index) => (
          <TextBlockUi key={index} {...item} />
        ))}
      </div>
    );
  }

  const { variant, icon: Icon1 } = ALERT_VARIANT_PER_DESCRIPTION_TYPE[type];

  return (
    <Alert variant={variant} className="my-2">
      <Icon1 className="w-4 h-4" />
      <AlertTitle className="first-letter:capitalize font-semibold">
        {type.replaceAll('_', ' ')}
      </AlertTitle>
      <AlertDescription className="whitespace-pre-line">
        <DescriptionItemsUi description={content} />
      </AlertDescription>
    </Alert>
  );
};

export const DescriptionItemsUi = ({
  description,
}: {
  description: DescriptionItem[];
}) => (
  <div className="flex flex-col">
    {description.map((item, index) => (
      <DescriptionItemUi key={index} {...item} />
    ))}
  </div>
);
