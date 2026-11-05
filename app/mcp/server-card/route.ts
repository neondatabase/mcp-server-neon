import {
  buildServerCard,
  discoveryResponse,
  SERVER_CARD_MEDIA_TYPE,
} from '@/lib/server-metadata';

export function GET() {
  return discoveryResponse(buildServerCard(), SERVER_CARD_MEDIA_TYPE);
}
