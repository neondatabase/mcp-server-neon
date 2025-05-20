import {
  DescriptionItem,
  DescriptionItemType,
  TextBlock,
} from '@/lib/description';
import { CodeSnippet } from '@/components/CodeSnippet';

const BG_COLORS_PER_DESCRIPTION_TYPE: Partial<
  Record<DescriptionItemType, string>
> = {
  use_case: 'bg-accent',
  next_steps: 'bg-accent',
  important_notes: 'bg-important-notes',
  workflow: 'bg-accent',
  instructions: 'bg-accent',
  response_instructions: 'bg-accent',
  example: 'bg-accent',
  do_not_include: 'bg-do-not-include',
  error_handling: 'bg-error-handling',
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
    <div
      className={`my-2 px-3 py-2 rounded-md ${BG_COLORS_PER_DESCRIPTION_TYPE[type]}`}
    >
      <div className="uppercase font-bold">[{type.replaceAll('_', ' ')}]</div>
      <div className="whitespace-pre-line">
        {content.map((item, index) => (
          <DescriptionItemUi key={index} {...item} />
        ))}
      </div>
    </div>
  );
};
