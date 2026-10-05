const entryKey = entry => `${entry.candidate.sport}:${entry.candidate.id}`;

function gameLockMenuItem({ engine, store, onError }) {
  // Capture the rendered game when the menu opens, even if rotation advances
  // while the native menu is being displayed.
  const gameKey = engine.output().gameKey;
  const eligible = () => {
    const state = engine.state();
    const queue = state.liveMode?.active ? state.liveQueue : state.normalQueue;
    return state.ready && !!gameKey && queue?.some(entry => entryKey(entry) === gameKey);
  };
  return {
    id: 'lock-current-game', label: 'Pin current game', type: 'checkbox',
    checked: !!gameKey && store.snapshot().config.lockedGameKeys.includes(gameKey),
    enabled: !!eligible(),
    click: item => {
      try {
        if (!eligible()) throw Error('This game is no longer in the current rotation.');
        const snapshot = store.snapshot();
        const locks = snapshot.config.lockedGameKeys;
        const lockedGameKeys = item.checked ? [...new Set([...locks, gameKey])]
          : locks.filter(key => key !== gameKey);
        const result = store.patch({ instance: snapshot.instance, expectedRevision: snapshot.revision,
          config: { lockedGameKeys } });
        if (result.status !== 200) throw Error('Settings changed. Try pinning the game again.');
      } catch (error) { onError(error); }
    },
  };
}

module.exports = { gameLockMenuItem };
