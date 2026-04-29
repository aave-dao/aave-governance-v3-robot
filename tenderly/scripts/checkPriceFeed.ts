import 'dotenv/config';
import {formatUnits, type Address} from 'viem';
import {getPublicClient} from '../src/core/clients';

const FEED: Address = '0xde49c7B5C0E54b1624ED21C7D88bA6593d444Aa0';
const FLAG_BLOCK = 24978771n;

const abi = [
  {
    type: 'function',
    name: 'latestAnswer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{type: 'int256'}],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{type: 'uint8'}],
  },
] as const;

const client = getPublicClient(1);
const latest = await client.getBlockNumber();
const decimals = await client.readContract({
  address: FEED,
  abi,
  functionName: 'decimals',
});

const offsets = [0n, 1n, 5n, 25n, 100n, 500n, 2000n, 7200n];
const candidates = [
  latest,
  FLAG_BLOCK,
  ...offsets.map((d) => FLAG_BLOCK - d),
  ...offsets.slice(1).map((d) => FLAG_BLOCK + d),
];
const blocks = candidates
  .filter((b, i, a) => a.indexOf(b) === i && b <= latest)
  .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

console.log(`feed=${FEED} decimals=${decimals} latest=${latest} flag=${FLAG_BLOCK}`);
console.log('block\tanswer\tprice');
for (const block of blocks) {
  try {
    const answer = await client.readContract({
      address: FEED,
      abi,
      functionName: 'latestAnswer',
      blockNumber: block,
    });
    console.log(`${block}\t${answer}\t${formatUnits(answer, decimals)}`);
  } catch (e) {
    console.log(`${block}\tERROR\t${(e as Error).message}`);
  }
}
