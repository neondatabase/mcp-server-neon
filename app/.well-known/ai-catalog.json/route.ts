import {
  AI_CATALOG_MEDIA_TYPE,
  buildAiCatalog,
  discoveryResponse,
} from '@/lib/server-metadata';

export function GET() {
  return discoveryResponse(buildAiCatalog(), AI_CATALOG_MEDIA_TYPE);
}
