import { DescriptionItem, DescriptionItemType } from '@/lib/description';

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

export const TextBlock = ({
  type,
  content,
}: {
  type: 'text' | 'code';
  content: string;
}) => {
  if (type === 'text') {
    return <div>{content}</div>;
  }

  return (
    <div className="monospaced whitespace-pre-wrap bg-zinc-100 px-2 py-1 my-2 border-l-4">
      {content}
    </div>
  );
};

export const DescriptionItemBlock = ({ type, content }: DescriptionItem) => {
  if (type === 'text') {
    return (
      <div className="whitespace-pre-line">
        {content.map((item, index) => (
          <TextBlock key={index} {...item} />
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
          <DescriptionItemBlock key={index} {...item} />
        ))}
      </div>
    </div>
  );
};
