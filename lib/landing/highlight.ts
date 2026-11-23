import he from 'he';

/**
 * Colours a code block's tokens the way Neon docs do (their Shiki theme): in shell the command
 * name, its plain arguments and its quoted strings; in JSON the keys, string values and
 * punctuation. Only class names are added, so the text a reader copies is the text shown.
 */
const token = (kind: string, text: string): string =>
  `<span class="tok-${kind}">${he.escape(text)}</span>`;

const SHELL_TOKEN = /"(?:\\.|[^"\\])*"|'[^']*'|\s+|[^\s"']+/gu;
const COMMAND_BREAK = /^(?:\||\|\||&&|;)$/u;

const shell = (source: string): string => {
  let atCommand = true;

  return Array.from(source.matchAll(SHELL_TOKEN), ([text]) => {
    if (text.trim() === '') {
      atCommand ||= text.includes('\n');

      return text;
    }

    if (COMMAND_BREAK.test(text)) {
      atCommand = true;

      return token('punct', text);
    }

    const quoted = text.startsWith('"') || text.startsWith("'");
    const word = atCommand ? 'fn' : 'str';

    atCommand = false;

    return token(quoted ? 'expr' : word, text);
  }).join('');
};

const JSON_TOKEN = /"(?:\\.|[^"\\])*"|[:,]|[^":,]+/gu;

const json = (source: string): string =>
  Array.from(source.matchAll(JSON_TOKEN), ({ 0: text, index }) => {
    if (text.startsWith('"')) {
      const isKey = source
        .slice(index + text.length)
        .trimStart()
        .startsWith(':');

      return token(isKey ? 'key' : 'expr', text);
    }

    return text === ':' || text === ','
      ? token('punct', text)
      : he.escape(text);
  }).join('');

export const highlight = (source: string, language?: string): string => {
  if (language === 'bash' || language === 'sh' || language === 'shell') {
    return shell(source);
  }

  if (language === 'json') {
    return json(source);
  }

  return he.escape(source);
};
