"use strict";
require('../../../scripts/offline-network.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
require('../../../core/registry.js');require('../../../sports/chess/layout.js');
const { clock } = global.SportsOverlay.chessLayout;
test('broadcast clocks preserve zero and convert centiseconds without inventing missing values',()=>{
 for (const [raw,label] of [[null,'—'],[undefined,'—'],[-1,'—'],[0,'0:00'],[6500,'1:05'],[185400,'30:54'],[566800,'1:34:28']]) assert.equal(clock(raw),label);
});

test('chess name links select the exact board or broadcast player card', () => {
 const { playerUrl } = global.SportsOverlay.chessLayout;
 const player = { id: 'fide:123', name: 'Gukesh D' };
 assert.equal(playerUrl(player, 'Round001', 'Game0001'), 'https://lichess.org/broadcast/-/-/Round001/Game0001');
 assert.equal(playerUrl(player, 'Round001'), 'https://lichess.org/broadcast/-/-/Round001#players/123');
 assert.equal(playerUrl({ id: 'name:O’Neil / A&B', name: 'O’Neil / A&B' }, 'Round002'), 'https://lichess.org/broadcast/-/-/Round002#players/O%E2%80%99Neil%20%2F%20A%26B');
 assert.equal(playerUrl(player, 'Round001', 'undefined'), 'https://lichess.org/broadcast/-/-/Round001#players/123');
 assert.equal(playerUrl(player, undefined, 'Game0001'), '');
});
