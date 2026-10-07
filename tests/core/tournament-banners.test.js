'use strict';
require('../../scripts/offline-network.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
require('../../core/config.js');
require('../../core/automatic-watches.js');
const { config: api, automaticWatches } = global.SportsOverlay;
test('separate tournament banners survive normalization with independent settings and stable keys', () => {
  for (const [sport, base] of [['chess', {tournamentId:'Tour1234',roundId:'',view:'overview'}], ['disc-golf',{tournamentId:'86076',division:'MPO',view:'leaderboard'}]]) {
    const config = api.normalizeConfig({sports:[{sport,events:[base,{...base,bannerId:'player-1',view:'player',playerId:sport==='chess'?'fide:123':'41760',enabled:false,leaderboardSize:3}]}]});
    const group = config.sports.find(g=>g.sport===sport);
    assert.equal(group.events.length,2);
    assert.equal(group.events[0].leaderboardSize,10);
    assert.equal(group.events[1].leaderboardSize,3);
    assert.notEqual(api.watchId(group.events[0]),api.watchId(group.events[1]));
    assert.equal(api.isCandidateEnabled(config,{sport,id:api.watchId(group.events[0])}),true);
    assert.equal(api.isCandidateEnabled(config,{sport,id:api.watchId(group.events[1])}),false);
    assert.deepEqual(api.normalizeConfig(config),config);
    group.events.reverse();
    assert.equal(api.watchId(group.events[0]),`${api.watchId(base)}:banner:player-1`);
  }
});
test('an additional player banner does not hide the automatic tournament watch', () => {
  const watch = {tournamentId:'Tour1234',roundId:'',view:'overview'};
  const config = api.normalizeConfig({sports:[{sport:'chess',autoFollow:true,events:[{...watch,bannerId:'player-1',view:'player'}]}]});
  const next = automaticWatches.reconcile(config,[{sport:'chess',automaticWatches:[watch],automaticWatchesComplete:true}]);
  assert.equal(next.automaticWatchLists.chess.length,1);
});

test('unfinished player banners are gated even when included or locked, and become eligible on selection', () => {
  for (const [sport, base, playerId] of [['chess',{tournamentId:'Tour1234',roundId:''},'fide:123'],['disc-golf',{tournamentId:'103574',division:'MPO'},'63765']]) {
    const config = api.normalizeConfig({sports:[{sport,events:[{...base,bannerId:'pending',view:'player',enabled:true,playerId:''}]}]});
    const watch = config.sports.find(g=>g.sport===sport).events[0];
    const candidate = {sport,id:api.watchId(watch),raw:{automatic:true}};
    config.includedGames=[`${sport}:${candidate.id}`];config.lockedGameKeys=[`${sport}:${candidate.id}`];
    assert.equal(api.isCandidateEnabled(config,candidate),false);
    assert.equal(watch.enabled,true);
    watch.playerId=playerId;
    assert.equal(api.isCandidateEnabled(config,candidate),true);
    watch.playerId='';
    assert.equal(api.isCandidateEnabled(config,candidate),false);
    watch.view=sport==='chess'?'overview':'leaderboard';
    assert.equal(api.isCandidateEnabled(config,candidate),true);
  }
});
