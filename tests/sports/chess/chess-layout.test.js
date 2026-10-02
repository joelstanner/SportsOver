"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
require('../../../core/registry.js');require('../../../sports/chess/layout.js');
const { clock } = global.SportsOverlay.chessLayout;
test('broadcast clocks preserve zero and convert centiseconds without inventing missing values',()=>{
 for (const [raw,label] of [[null,'—'],[undefined,'—'],[-1,'—'],[0,'0:00'],[6500,'1:05'],[185400,'30:54'],[566800,'1:34:28']]) assert.equal(clock(raw),label);
});
