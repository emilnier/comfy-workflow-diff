const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deflateSync } = require('node:zlib');
const core = require('../core.js');

const node = (id, values = {}, mode = 0, type = 'KSampler') => ({
  id, type, mode, pos: [id * 280, 0], size: [220, 100],
  inputs: [], outputs: [], widgets_values_named: values
});
const workflow = nodes => ({ nodes, links: [], groups: [] });
const parse = data => core.parseFileBuffer(Buffer.from(JSON.stringify(data)), 'synthetic.json');

test('large integer seeds stay exact; malformed JSON is rejected', () => {
  const parsed = core.parseJSONLossless('{"seed":1234567890123456789,"__proto__":{"x":1}}');
  assert.equal(parsed.seed, 1234567890123456789n);
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal({}.x, undefined);
  for (const invalid of ['{"a":1,}', '[1,]', '01', '"unterminated']) {
    assert.throws(() => core.parseJSONLossless(invalid), SyntaxError);
  }
});

test('parameter, bypass, enable and added/removed nodes produce A to B actions', async () => {
  const a = await parse(workflow([node(1, { steps: 20 }), node(2), node(3, {}, 4), node(4)]));
  const b = await parse(workflow([node(1, { steps: 28 }), node(2, {}, 4), node(3), node(5)]));
  const diff = core.compareParsed(a, b);
  assert.deepEqual(diff.stats.actionCounts, { copy: 1, bypass: 1, enable: 1, mode: 0, add: 1, remove: 1 });
  assert.equal(diff.stats.changedNodes, 5);
  assert.match(core.buildActionChecklist(diff), /28/);
  assert.match(core.buildMarkdownReport(diff), /A → B/);
  assert.equal(core.compareParsed(a, a).identical, true);
});

test('position, color and collapsed flags are ignored', async () => {
  const a = workflow([node(1, { steps: 20 })]);
  const b = structuredClone(a);
  Object.assign(b.nodes[0], { pos: [100, 500], color: '#ffffff', flags: { collapsed: true } });
  assert.equal(core.compareParsed(await parse(a), await parse(b)).identical, true);
});

test('API comparison detects a changed output slot on the same source', async () => {
  const a = { 1: { class_type: 'Source', inputs: {} }, 2: { class_type: 'Target', inputs: { image: ['1', 0] } } };
  const b = structuredClone(a);
  b[2].inputs.image[1] = 1;
  const left = await parse(a), right = await parse(b);
  assert.equal(core.compareParsed(left, right).identical, true);
  const diff = core.compareParsed(left, right, { compareLinks: true });
  assert.equal(diff.stats.link, 1);
  assert.notEqual(diff.nodeResults[0].items[0].valueA, diff.nodeResults[0].items[0].valueB);
});

test('internal subgraph mode changes do not tell users to change the parent mode', async () => {
  const a = workflow([node(1, {}, 0, 'example-subgraph')]);
  a.definitions = { subgraphs: [{ id: 'example-subgraph', name: 'Example', nodes: [node(10, {}, 4)], links: [], groups: [] }] };
  const b = structuredClone(a);
  b.definitions.subgraphs[0].nodes[0].mode = 0;
  const diff = core.compareParsed(await parse(a), await parse(b));
  assert.equal(diff.stats.status, 1);
  assert.equal(diff.nodeResults[0].action, 'mode');
  assert.match(diff.nodeResults[0].actionLabel, /子图内部/);
  assert.equal(diff.nodeResults[0].modeFrom, diff.nodeResults[0].modeTo);
});

// Minimal valid PNG containers, generated here without personal images or metadata.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(type, key, text) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  let metadata;
  if (type === 'tEXt') metadata = Buffer.from(key + '\0' + text);
  if (type === 'zTXt') metadata = Buffer.concat([Buffer.from(key + '\0\0'), deflateSync(Buffer.from(text))]);
  if (type === 'iTXt') metadata = Buffer.concat([Buffer.from(key + '\0\1\0\0\0'), deflateSync(Buffer.from(text))]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk(type, metadata), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))
  ]);
}
for (const type of ['tEXt', 'zTXt', 'iTXt']) {
  test('PNG ' + type + ' metadata restores a synthetic workflow', async () => {
    const bytes = png(type, 'workflow', JSON.stringify(workflow([node(1, { steps: 20 })])));
    const parsed = await core.parseFileBuffer(bytes, 'example.png');
    assert.equal(parsed.kind, 'workflow');
    assert.equal(parsed.nodes[0].params[0].value, 20);
    assert.equal(parsed.width, 1);
  });
}

test('A1111 metadata supports summary comparison with a full workflow', async () => {
  const bytes = png('tEXt', 'parameters', 'a landscape\nNegative prompt: blurry\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Size: 512x512');
  const summary = await core.parseFileBuffer(bytes, 'example.png');
  assert.equal(summary.kind, 'a1111');
  const full = await parse(workflow([node(1, { steps: 28 })]));
  assert.equal(core.compareParsed(full, summary).mode, 'summary');
});

test('empty and unsupported files produce useful errors', async () => {
  await assert.rejects(core.parseFileBuffer(Buffer.alloc(0), 'empty.json'), /空/);
  await assert.rejects(core.parseFileBuffer(Buffer.from('invalid'), 'invalid.txt'), /不认识/);
});
