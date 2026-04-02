import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { MEDIA_PROTOCOL_SCHEME } from '@shared/constants';

function buildErrorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    const filePath = requestUrl.searchParams.get('path');

    if (!filePath) {
      return buildErrorResponse(400, 'missing_path');
    }
    if (!fs.existsSync(filePath)) {
      return buildErrorResponse(404, 'file_not_found');
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
