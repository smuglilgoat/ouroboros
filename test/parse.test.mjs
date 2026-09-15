import assert from 'node:assert';
import { parseJson3 } from '../extension/lib/parse.mjs';

// basic parse + consecutive-duplicate collapse (ASR rolling captions)
const out = parseJson3({
  events: [
    { segs: [{ utf8: ' hello ' }] },
    { segs: [{ utf8: 'hello' }] },
    { segs: [{ utf8: ' world\n' }, { utf8: ' again' }] },
    {},
    { segs: [{ utf8: '<c> markup' }] },
  ],
});
assert.equal(out, 'hello world again <c> markup');

assert.equal(parseJson3({}), '');
assert.equal(parseJson3({ events: [{ segs: [] }] }), '');
console.log('parse.test.mjs ✓');
