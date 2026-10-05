const entryKey = entry => `${entry.candidate.sport}:${entry.candidate.id}`;

function gameRemoveMenuItem({ engine, store, onError }) {
  const gameKey = engine.output().gameKey;
  const eligible = () => {
    const state = engine.state();
    const queue = state.liveMode?.active ? state.liveQueue : state.normalQueue;
    return state.ready && !!gameKey && queue?.some(entry => entryKey(entry) === gameKey);
  };
  return {
    id: 'remove-current-game', label: 'Remove from rotation', enabled: !!eligible(),
    click: () => {
      try {
        if (!eligible()) throw Error('This game is no longer in the current rotation.');
        const snapshot = store.snapshot();
        const config = snapshot.config;
        const state = engine.state();
        const isAutomatic = state.automaticEntries?.some(entry => entryKey(entry) === gameKey);
        const includedGames = config.includedGames.filter(key => key !== gameKey);
        const excludedGames = isAutomatic || state.liveMode?.active
          ? [...new Set([...config.excludedGames, gameKey])]
          : config.excludedGames.filter(key => key !== gameKey);
        const rotationMode = config.rotationMode === 'hybrid' && !includedGames.length && !excludedGames.length
          ? 'automatic' : config.rotationMode;
        const result = store.patch({ instance: snapshot.instance, expectedRevision: snapshot.revision,
          config: { includedGames, excludedGames, rotationMode,
            rotationOrder: config.rotationOrder.filter(key => key !== gameKey),
            lockedGameKeys: config.lockedGameKeys.filter(key => key !== gameKey) } });
        if (result.status !== 200) throw Error('Settings changed. Try removing the game again.');
      } catch (error) { onError(error); }
    },
  };
}

module.exports = { gameRemoveMenuItem };
