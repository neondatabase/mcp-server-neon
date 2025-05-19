const POSSIBLE_TYPES = [
  'use_case',
  'workflow',
  'important_notes',
  'next_steps',
  'response_instructions',
  'instructions',
  'example',
  'do_not_include',
  'error_handling',
] as const;

export type DescriptionItemType = (typeof POSSIBLE_TYPES)[number];

export type DescriptionItem =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: DescriptionItemType;
      content: DescriptionItem[];
    };

function isValidType(string: string): string is DescriptionItemType {
  return POSSIBLE_TYPES.includes(string as DescriptionItemType);
}

export function parseDescription(description: string): DescriptionItem[] {
  const parts: DescriptionItem[] = [];
  let rest = description;

  while (rest.length > 0) {
    const match = rest.match(
      /<(use_case|workflow|important_notes|next_steps|response_instructions|instructions|example|do_not_include|error_handling)>(.*?)<\/\1>/s,
    );

    if (!match) {
      parts.push({
        type: 'text',
        content: rest,
      });
      break;
    }

    const type = match[1];

    if (!isValidType(type)) {
      throw new Error('Invalid type');
    }

    if ((match.index ?? 0) > 0) {
      parts.push({
        type: 'text',
        content: rest.slice(0, match.index).trim(),
      });
    }

    parts.push({
      type,
      content: parseDescription(match[2].trim()),
    });

    rest = rest.substring((match.index ?? 0) + match[0].length).trim();
  }

  return parts;
}
