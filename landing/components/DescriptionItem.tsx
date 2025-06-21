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
      <div className="text-sm-24px">
        {block.content.map((item, index) =>
          item.type === 'text' ? (
            item.content
          ) : (
            <span key={index} className="monospaced bg-secondary p-1 py-0-25">
              {item.content}
            </span>
          ),
        )}
      </div>
    );
  }

  return <CodeSnippet type={block.syntax}>{block.content}</CodeSnippet>;
};

export const DescriptionItemUi = (item: DescriptionItem) => {
  if (item.type === 'text') {
    return (
      <div className="whitespace-pre-line">
        {item.content.map((childItem, index) => (
          <TextBlockUi key={index} {...childItem} />
        ))}
      </div>
    );
  }

  // If an example section contains only code snippet then render snippet
  // without a section wrapper. An extra wrapper makes the code less readable.
  if (
    item.type === 'example' &&
    item.content.length === 1 &&
    item.content[0].type === 'text' &&
    item.content[0].content.length === 1 &&
    item.content[0].content[0].type === 'code'
  ) {
    const snippet = item.content[0].content[0];

    return <CodeSnippet type={snippet.syntax}>{snippet.content}</CodeSnippet>;
  }

  const { variant, icon: IconComp } =
    ALERT_VARIANT_PER_DESCRIPTION_TYPE[item.type];

  return (
    <Alert variant={variant} className="my-2">
      <IconComp className="w-4 h-4" />
      <AlertTitle className="first-letter-capitalize font-semibold">
        {item.type.replaceAll('_', ' ')}
      </AlertTitle>
      <AlertDescription className="whitespace-pre-line">
        <DescriptionItemsUi description={item.content} />
      </AlertDescription>
    </Alert>
  );
};

export const DescriptionItemsUi = ({
  description,
}: {
  description: DescriptionItem[];
}) => (
  <div className="flex flex-col gap-2">
    {description.map((item, index) => (
      <DescriptionItemUi key={index} {...item} />
    ))}
  </div>
);
