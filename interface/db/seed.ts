// Seeds the listener cursor at (latest L1 block - 100) so the first poll has a small back-window.
import 'dotenv/config';
import postgres from 'postgres';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const rpcUrl = process.env.RPC_MAINNET
  ?? (process.env.ALCHEMY_API_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : mainnet.rpcUrls.default.http[0]);
if (!rpcUrl) throw new Error('No L1 RPC available — set ALCHEMY_API_KEY or RPC_MAINNET');

const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
const latest = await client.getBlockNumber();
const seedBlock = latest > 100n ? latest - 100n : 0n;

const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql`
    INSERT INTO cursors (name, chain_id, last_block, updated_at)
    VALUES ('voting_activated_l1', 1, ${seedBlock.toString()}::bigint, now())
    ON CONFLICT (name) DO NOTHING
  `;
  console.log(`cursor 'voting_activated_l1' seeded at block ${seedBlock}`);
} finally {
  await sql.end({ timeout: 5 });
}
