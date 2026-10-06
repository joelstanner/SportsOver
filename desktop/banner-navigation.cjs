'use strict';

function browseFeedback(state, pinnedKeys = []) {
  if (!state.ready) return 'Banners are loading…';
  if (state.overrideGameKey || state.override) return 'Temporary game active. End the override in Settings to browse.';
  if (state.queue?.length >= 2) return '';
  if (state.queue?.length === 1 && pinnedKeys.includes(state.currentGameKey)) {
    return 'Only one game pinned. Pin another game or unpin this game to browse.';
  }
  if (!state.discoveryComplete || state.discoveryPending || state.loadingSports?.length) {
    return 'Banners are loading…';
  }
  return state.queue?.length === 1 ? 'Only one game in rotation. Add more games in Live control to browse.' : 'No games in rotation. Add games in Live control.';
}

module.exports = { browseFeedback };
