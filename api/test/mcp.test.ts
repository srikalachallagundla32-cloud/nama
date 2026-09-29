import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.ts';
import { makeApp } from './helpers.ts';

async function connect() {
  const { store, retriever } = makeApp();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(store, retriever); await server.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' }); await client.connect(b);
  return client;
}

test('MCP: five tools, all read-only', async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_name', 'list_books', 'search_names', 'semantic_search_names', 'similar_sounding']);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test('MCP: tools return grounded data', async () => {
  const c = await connect();
  const r = await c.callTool({ name: 'similar_sounding', arguments: { name: 'Savannah', gender: 'm', limit: 3 } });
  const data = JSON.parse((r.content as { text: string }[])[0]!.text);
  assert.equal(data.results[0].name, 'Saavan');
  const k = await c.callTool({ name: 'search_names', arguments: { book: 'korkut', limit: 20 } });
  const ids = JSON.parse((k.content as { text: string }[])[0]!.text).results.map((x: { id: string }) => x.id);
  assert.ok(ids.includes('Banucicek|tr') && ids.includes('Selcan|tr'));
});

test('MCP: invalid input is refused, not guessed', async () => {
  const c = await connect();
  let refused = false;
  try { const r = await c.callTool({ name: 'search_names', arguments: { language: 'klingon' } }); refused = r.isError === true; } catch { refused = true; }
  assert.ok(refused);
  const g = await c.callTool({ name: 'get_name', arguments: { id: 'Nobody|xx' } });
  assert.equal(g.isError, true);
});
