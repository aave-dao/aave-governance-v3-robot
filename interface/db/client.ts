import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

let cachedDb: ReturnType<typeof drizzle> | undefined;
let cachedSql: Sql | undefined;

const connect = () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  cachedSql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  cachedDb = drizzle(cachedSql, { schema });
};

// Lazy proxy: defer the postgres connection until the first DB call. This way `import { db }`
// at module-eval time during `next build` doesn't require DATABASE_URL to be set.
export const db: ReturnType<typeof drizzle> = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!cachedDb) connect();
    return Reflect.get(cachedDb as object, prop);
  },
});
