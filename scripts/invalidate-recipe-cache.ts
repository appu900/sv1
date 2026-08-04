/**
 * Invalidate Make-feed recipe caches on prod (cluster-safe).
 *
 * From ~/sv1:
 *   npx tsx scripts/invalidate-recipe-cache.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import Redis, { RedisOptions } from 'ioredis';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function delByPattern(client: Redis, pattern: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length) {
      // One DEL per key — avoids CROSSSLOT on serverless/cluster Valkey
      await Promise.all(keys.map((key) => client.del(key)));
      deleted += keys.length;
    }
  } while (cursor !== '0');
  return deleted;
}

async function main() {
  const host = process.env.REDIS_HOST || process.env.VALKEY_HOST || '';
  const url = process.env.REDIS_URL || process.env.VALKEY_URL || '';
  if (!host && !url) {
    throw new Error(
      'REDIS_HOST / REDIS_URL missing. Run from ~/sv1 with .env present, or: export $(grep -E \'^REDIS_\' .env | xargs)',
    );
  }

  console.log(
    `Connecting Redis → ${url || `${host}:${process.env.REDIS_PORT || 6379}`}`,
  );

  const options: RedisOptions = {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 8000,
    tls: {},
    username: process.env.REDIS_USERNAME || process.env.VALKEY_USERNAME,
    password: process.env.REDIS_PASSWORD || process.env.VALKEY_PASSWORD,
  };

  const client = url
    ? new Redis(url.replace(/^redis:\/\//, 'rediss://'), options)
    : new Redis({
        host,
        port: Number(process.env.REDIS_PORT || process.env.VALKEY_PORT || 6379),
        db: Number(process.env.REDIS_DB || process.env.VALKEY_DB || 0),
        ...options,
      });

  client.on('error', (err) => {
    console.warn('[redis]', err.message);
  });

  try {
    await client.ping();
    const gen = await client.incr('cache:gen:recipes');
    const recipesDeleted = await delByPattern(client, 'recipes:*');
    const dietaryDeleted = await delByPattern(client, 'dietary:*');
    const recipesVersion = await client.incr('dataversion:recipes');
    const chefsVersion = await client.incr('dataversion:chefs');
    const stickersVersion = await client.incr('dataversion:stickers');

    console.log(
      JSON.stringify(
        {
          success: true,
          cacheGenRecipes: gen,
          deleted: { recipes: recipesDeleted, dietary: dietaryDeleted },
          dataVersions: {
            recipes: recipesVersion,
            chefs: chefsVersion,
            stickers: stickersVersion,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await client.quit().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
