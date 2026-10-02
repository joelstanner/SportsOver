'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../../core/config.js');require('../../core/automatic-watches.js');
const api=global.SportsOverlay,watch={tournamentId:'Tour1234',roundId:'',name:'Elite Open',enabled:true,view:'overview',playerId:''};
function config(){const c=api.config.normalizeConfig();c.sports.find(g=>g.sport==='disc-golf').autoFollow=true;return c;}
test('automatic watches persist separately from manual choices, deduplicate, and retire after a healthy search',()=>{
 const c=config();c.sports.find(g=>g.sport==='chess').events=[{...watch,tournamentId:'Manual01',view:'player',playerId:'fide:123'}];
 let next=api.automaticWatches.reconcile(c,[{sport:'chess',automaticWatches:[watch,watch,{...watch,tournamentId:'Manual01'}],automaticWatchesComplete:true}]);
 assert.deepEqual(next.automaticWatchLists.chess,[watch]);assert.equal(next.sports.find(g=>g.sport==='chess').events[0].playerId,'fide:123');
 next=api.automaticWatches.reconcile(next,[{sport:'chess',automaticWatches:[],automaticWatchesComplete:true}]);
 assert.deepEqual(next.automaticWatchLists.chess,[]);assert.equal(next.sports.find(g=>g.sport==='chess').events.length,1);
});
test('partial failures, offline discovery, paused discovery and disabled sports cannot erase saved automatic watches',()=>{
 const c=config();c.automaticWatchLists.chess=[watch];
 for(const result of [{sport:'chess',automaticWatches:null},{sport:'chess',automaticWatches:[],automaticWatchesComplete:false}])assert.deepEqual(api.automaticWatches.reconcile(c,[result]).automaticWatchLists.chess,[watch]);
 const partial=api.automaticWatches.reconcile(c,[{sport:'chess',automaticWatches:[{...watch,tournamentId:'NewTour1'}],automaticWatchesComplete:false}]);assert.equal(partial.automaticWatchLists.chess.length,2);
 const group=c.sports.find(g=>g.sport==='chess');group.autoFollow=false;
 assert.deepEqual(api.automaticWatches.reconcile(c,[{sport:'chess',automaticWatches:[],automaticWatchesComplete:true}]).automaticWatchLists.chess,[watch]);
 group.autoFollow=true;group.enabled=false;
 assert.deepEqual(api.automaticWatches.reconcile(c,[{sport:'chess',automaticWatches:[],automaticWatchesComplete:true}]).automaticWatchLists.chess,[watch]);
});
test('discovery synchronizes only its own field and never overwrites simultaneous user changes',async()=>{
 const original=api.config,shared=api.shared;let c=config(),writes=0;
 api.shared={snapshot:()=>({revision:7,instance:'test'})};
 api.config={...original,loadConfig:()=>c,saveConfig:async(next,options)=>{writes++;assert.deepEqual(options,{fields:['automaticWatchLists'],revision:7,instance:'test'});c={...c,automaticWatchLists:next.automaticWatchLists};return c;}};
 try{
  const results=[{sport:'chess',automaticWatches:[watch],automaticWatchesComplete:true}];
  await api.automaticWatches.sync(results);assert.equal(writes,1);
  await api.automaticWatches.sync(results);assert.equal(writes,1,'no write for an unchanged directory');
  c.rotationSeconds=55;
  await api.automaticWatches.sync([{sport:'chess',automaticWatches:[],automaticWatchesComplete:true}]);assert.equal(c.rotationSeconds,55);
 }finally{api.config=original;api.shared=shared;}
});
