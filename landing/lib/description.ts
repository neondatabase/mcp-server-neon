import { min } from 'lodash';

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
      content: TextBlock[];
    }
  | {
      type: DescriptionItemType;
      content: DescriptionItem[];
    };

export type TextBlock =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'code';
      syntax?: string;
      content: string;
    };

function isValidType(string: string): string is DescriptionItemType {
  return POSSIBLE_TYPES.includes(string as DescriptionItemType);
}

function removeRedundantIndentation(text: string): string {
  const lines = text.split('\n');
  const minIndent = min(
    lines.map((line) => line.match(/^\s+/)?.[0].length ?? 0),
  );
  if (!minIndent) {
    return text;
  }

  return lines.map((line) => line.substring(minIndent)).join('\n');
}

function highlightCodeBlocks(description: string): TextBlock[] {
  const parts: TextBlock[] = [];
  let rest = description.trim();

  while (rest.length > 0) {
    const match = rest.match(/```([^\n]*?)\n(.*?)\n\s*?```/s);

    if (!match) {
      parts.push({
        type: 'text',
        content: rest,
      });
      break;
    }

    if ((match.index ?? 0) > 0) {
      parts.push({
        type: 'text',
        content: rest.slice(0, match.index).trim(),
      });
    }

    parts.push({
      type: 'code',
      syntax: match[1].trim() || undefined,
      content: removeRedundantIndentation(match[2]),
    });

    rest = rest.substring((match.index ?? 0) + match[0].length).trim();
  }

  return parts;
}

export function parseDescription(description: string): DescriptionItem[] {
  const parts: DescriptionItem[] = [];
  let rest = description.trim();

  while (rest.length > 0) {
    const match = rest.match(
      /<(use_case|workflow|important_notes|next_steps|response_instructions|instructions|example|do_not_include|error_handling)>(.*?)<\/\1>/s,
    );

    if (!match) {
      parts.push({
        type: 'text',
        content: highlightCodeBlocks(rest),
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
        content: highlightCodeBlocks(rest.slice(0, match.index).trim()),
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
