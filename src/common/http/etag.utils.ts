import * as crypto from 'crypto';
export function generateETag(data: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
}
