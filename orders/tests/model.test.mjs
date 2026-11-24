import assert from 'node:assert/strict';
import test from 'node:test';
import {quantity,remaining,esc,orderNumber,packedQuantity,formatPackedQuantity} from '../model.js';
test('quantities, escaping and balances keep business values exact',()=>{
  assert.equal(quantity('１，２３４．５６７'),1234.567);
  for(const v of ['','0','-1','0.0001','Infinity','NaN'])assert.throws(()=>quantity(v));
  assert.equal(remaining({quantity:'0.3',shipped_quantity:'0.1'}),0.2);
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
  assert.equal(orderNumber(1),'J-000001');
});
test('pack totals are exact with full-width input, fractions and large quantities',()=>{
  assert.equal(packedQuantity('２',24),48000n);
  assert.equal(formatPackedQuantity(packedQuantity('１，０００．２５',24)),'24,006');
  assert.equal(formatPackedQuantity(packedQuantity('0.123',12)+packedQuantity('0.5',1)),'1.976');
  assert.equal(formatPackedQuantity(packedQuantity('99999999999.999',999999)),'99,999,899,999,999,000.001');
  for(const [value,pack] of [['2',null],['2',0],['2',1.5],['2','24'],['',24],['0',24],['1.2345',24]]){
    assert.equal(packedQuantity(value,pack),null);
  }
});
