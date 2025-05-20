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
import { Terminal, CircleAlert } from 'lucide-react';

const ALERT_VARIANT_PER_DESCRIPTION_TYPE: Record<
  DescriptionItemType,
  AlertVariant
> = {
  use_case: 'default',
  next_steps: 'default',
  important_notes: 'important',
  workflow: 'default',
  instructions: 'default',
  response_instructions: 'default',
  example: 'default',
  do_not_include: 'destructive',
  error_handling: 'destructive',
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

  return (
    <Alert variant={ALERT_VARIANT_PER_DESCRIPTION_TYPE[type]} className="my-2">
      {['important_notes', 'do_not_include'].includes(type) ? (
        <CircleAlert className="w-4 h-4" />
      ) : (
        <Terminal className="w-4 h-4" />
      )}
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
  <div className="flex flex-col gap-1">
    {description.map((item, index) => (
      <DescriptionItemUi key={index} {...item} />
    ))}
  </div>
);
