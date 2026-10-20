import { readFile } from 'node:fs/promises';
import { CodexClient } from './codex.mjs';

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const personas = JSON.parse(await readFile(new URL('./personas.json', import.meta.url), 'utf8'));
const client = new CodexClient(config, (kind, value) => console.log(kind, JSON.stringify(value)));
try {
  await client.start();
  if (process.argv.includes('--sample')) {
    const fixture = { session: '123456789', seq: 2, kind: 'death', bot: 1, human: 0, owner: 0, killer: 1, unitName: 'Рыцарь смерти', level: 3, text: 'Тестовый герой', audience: [{ slot: 0, name: 'Игрок', relation: 'enemy' }] };
    console.log('SYNTHETIC_FIXTURE_REPLY', await client.generate(fixture, { ...personas[0], slot: 1, name: 'AMAI-Test' }, []));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await client.close(); }
