import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { MEDIA_PROTOCOL_SCHEME, SUPPORTED_IMPORT_EXT } from '@shared/constants';

function buildErrorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}

function inferMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.flac':
      return 'audio/flac';
    case '.aac':
      return 'audio/aac';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

function createFileStreamResponse(
  filePath: string,
  options?: {
    start?: number;
    end?: number;
    status?: number;
    totalSize?: number;
  }
): Response {
  const stat = fs.statSync(filePath);
  const totalSize = options?.totalSize ?? stat.size;
  const start = options?.start ?? 0;
  const end = options?.end ?? Math.max(0, totalSize - 1);
  const contentLength = totalSize === 0 ? 0 : Math.max(0, end - start + 1);
  const headers = new Headers({
    'content-type': inferMimeType(filePath),
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    'content-length': String(contentLength)
  });

  if (options?.status === 206) {
    headers.set('content-range', `bytes ${start}-${end}/${totalSize}`);
  }

  if (contentLength === 0) {
    return new Response(null, {
      status: options?.status ?? 200,
      headers
    });
  }

  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: options?.status ?? 200,
    headers
  });
}

function buildRangeNotSatisfiableResponse(totalSize: number, filePath: string): Response {
  return new Response(null, {
    status: 416,
    headers: {
      'content-type': inferMimeType(filePath),
      'accept-ranges': 'bytes',
      'content-range': `bytes */${totalSize}`
    }
  });
}

function parseByteRange(
  rangeHeader: string,
  totalSize: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const safeLength = Math.min(totalSize, Math.floor(suffixLength));
    return {
      start: Math.max(0, totalSize - safeLength),
      end: Math.max(0, totalSize - 1)
    };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const safeStart = Math.floor(start);
  const safeEnd = Math.min(totalSize - 1, Math.floor(end));
  if (safeStart < 0 || safeStart >= totalSize || safeEnd < safeStart) {
    return null;
  }
  return {
    start: safeStart,
    end: safeEnd
  };
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
    if (!SUPPORTED_IMPORT_EXT.includes(path.extname(filePath).toLowerCase())) {
      return createFileStreamResponse(filePath);
    }

    const stat = fs.statSync(filePath);
    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) {
      return createFileStreamResponse(filePath, { totalSize: stat.size });
    }

    const range = parseByteRange(rangeHeader, stat.size);
    if (!range) {
      return buildRangeNotSatisfiableResponse(stat.size, filePath);
    }

    return createFileStreamResponse(filePath, {
      start: range.start,
      end: range.end,
      status: 206,
      totalSize: stat.size
    });
  });
}
