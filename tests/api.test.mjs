import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readNdjson } from '../src/api.js';
import worker from '../dist/server/index.js';

test('NDJSON handles split UTF-8 characters, heartbeats, and a final line without newline',async()=>{
  const bytes=new TextEncoder().encode('\n{"name":"José"}\n\n{"id":"last"}');
  const stream=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const items=[];await readNdjson(new Response(stream),x=>items.push(x));
  assert.deepEqual(items,[{name:'José'},{id:'last'}]);
});
test('incremental discovery can stop and cancels the upstream reader',async()=>{
  let canceled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"id":1}\n{"id":2}\n'));},cancel(){canceled=true;}});
  const items=[];await readNdjson(new Response(stream),item=>{items.push(item);return false;});
  assert.deepEqual(items,[{id:1}]);assert.equal(canceled,true);
});
test('Worker serves bundled assets and restricts proxy endpoints and request bodies',async()=>{
  assert.equal((await worker.fetch(new Request('https://viewer.example/'))).status,200);
  assert.equal((await worker.fetch(new Request('https://viewer.example/pieces/wN.svg'))).headers.get('content-type'),'image/svg+xml');
  for(const endpoint of ['/lichess/api/account','/lichess/https://example.com','/lichess/api/tournament/../../account'])assert.equal((await worker.fetch(new Request(`https://viewer.example${endpoint}`))).status,400);
  assert.equal((await worker.fetch(new Request('https://viewer.example/lichess/api/games/export/_ids',{method:'POST',body:'not,a,game-id'}))).status,400);
});
test('Worker serves the Homura PNG without corrupting its bytes',async()=>{
  const response=await worker.fetch(new Request('https://viewer.example/homura.png'));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL('../public/homura.png',import.meta.url)));
  const head=await worker.fetch(new Request('https://viewer.example/homura.png',{method:'HEAD'}));
  assert.equal(head.status,200);
  assert.equal(head.headers.get('content-type'),'image/png');
  assert.equal(await head.text(),'');
});
