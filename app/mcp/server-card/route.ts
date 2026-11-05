import {
  buildServerCard,
  discoveryPreflight,
  discoveryResponse,
  SERVER_CARD_MEDIA_TYPE,
} from '@/lib/server-metadata';

export function GET() {
  return discoveryResponse(buildServerCard(), SERVER_CARD_MEDIA_TYPE);
}

export const OPTIONS = discoveryPreflight;
