import { DescriptionItem, DescriptionItemType } from '@/lib/description';

const BG_COLORS_PER_DESCRIPTION_TYPE: Partial<
  Record<DescriptionItemType, string>
> = {
  use_case: 'bg-accent',
  next_steps: 'bg-accent',
  important_notes: 'bg-orange-100',
  workflow: 'bg-accent',
  instructions: 'bg-accent',
  response_instructions: 'bg-accent',
  example: 'bg-accent',
  do_not_include: 'bg-red-300',
  error_handling: 'bg-red-100',
};

export const DescriptionItemBlock = ({ type, content }: DescriptionItem) => {
  if (type === 'text') {
    return <div className="whitespace-pre-line">{content}</div>;
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
