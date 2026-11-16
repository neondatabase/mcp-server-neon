type LandingFormat = 'html' | 'markdown';

const quality = (accept: string, mediaType: string): number =>
  accept.split(',').reduce((best, range) => {
    const [type, ...parameters] = range.split(';');

    if (type?.trim().toLowerCase() !== mediaType) {
      return best;
    }

    const q = parameters
      .map((parameter) => parameter.trim().toLowerCase().split('='))
      .find(([name]) => name === 'q');

    const value = q === undefined ? 1 : Number(q[1]);

    return Math.max(best, Number.isNaN(value) ? 0 : value);
  }, 0);

export const landingPageFormat = (req: Request): LandingFormat | undefined => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return undefined;
  }

  if (req.headers.has('authorization')) {
    return undefined;
  }

  const accept = req.headers.get('accept');

  if (accept === null || accept.toLowerCase().includes('text/event-stream')) {
    return undefined;
  }

  const html = quality(accept, 'text/html');
  const markdown = quality(accept, 'text/markdown');

  if (markdown > 0 && markdown >= html) {
    return 'markdown';
  }

  return html > 0 ? 'html' : undefined;
};

export const isLandingPageRequest = (req: Request): boolean =>
  landingPageFormat(req) !== undefined;
