import assert from 'node:assert/strict';
import test from 'node:test';
import {quantity,remaining,esc,orderNumber} from '../model.js';
test('quantities, escaping and balances keep business values exact',()=>{
  assert.equal(quantity('１，２３４．５６７'),1234.567);
  for(const v of ['','0','-1','0.0001','Infinity','NaN'])assert.throws(()=>quantity(v));
  assert.equal(remaining({quantity:'0.3',shipped_quantity:'0.1'}),0.2);
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
  assert.equal(orderNumber(1),'J-000001');
});
