"use strict";

(function initializeGameSelection(global) {
  function espnCandidate(event, sport) {
    const competition = event.competitions?.[0] ?? event;
    const competitors = competition.competitors ?? [];
    const status = competition.status ?? event.status ?? {};
    const state = normalizeState(status.type?.state);
    const scores = competitors.map(competitor => finiteNumber(competitor.score?.value ?? competitor.score)).filter(value => value !== null);
    const rankings = competitors
      .map(competitor => finiteNumber(competitor.curatedRank?.current))
      .filter(rank => rank !== null && rank > 0 && rank <= 25);
    const broadcasts = competition.broadcasts ?? event.broadcasts ?? [];
    const odds = competition.odds?.[0] ?? event.odds?.[0] ?? {};
    const notes = [...(competition.notes ?? []), ...(event.notes ?? [])];
    const seasonType = Number(event.season?.type ?? competition.season?.type);

    return {
      id: String(event.id ?? competition.id ?? ""),
      raw: event,
      sport,
      state,
      startTime: event.date ?? competition.date ?? null,
      teamKeys: competitors.flatMap(competitor => [competitor.id, competitor.team?.id, competitor.team?.abbreviation, competitor.team?.slug])
        .filter(Boolean)
        .map(value => String(value).toUpperCase()),
      postseason: seasonType === 3 || notes.some(note => /playoff|championship|bowl|final/i.test(note.headline || note.text || "")),
      nationalBroadcast: broadcasts.some(broadcast => String(broadcast.market || "").toLowerCase() === "national"),
      rankings,
      spread: finiteNumber(odds.spread),
      scoreMargin: scores.length >= 2 ? Math.abs(scores[0] - scores[1]) : null,
      period: finiteNumber(status.period),
    };
  }

  function mlbCandidate(game) {
    const scores = [game.linescore?.teams?.away?.runs, game.linescore?.teams?.home?.runs]
      .map(finiteNumber)
      .filter(value => value !== null);
    return {
      id: String(game.gamePk ?? game.id ?? ""),
      raw: game,
      sport: "baseball",
      state: normalizeState(game.status?.abstractGameState),
      startTime: game.gameDate ?? null,
      teamKeys: [game.teams?.away?.team?.id, game.teams?.home?.team?.id].filter(Boolean).map(String),
      postseason: ["F", "D", "L", "W"].includes(game.gameType),
      nationalBroadcast: (game.broadcasts ?? []).some(broadcast => broadcast.isNational === true),
      rankings: [],
      spread: null,
      scoreMargin: scores.length >= 2 ? Math.abs(scores[0] - scores[1]) : null,
      period: finiteNumber(game.linescore?.currentInning),
    };
  }

  function buildRotationQueue({ favoriteGames = [], leagueGames = [], favoriteTeamIds = [], toCandidate, fallbackMode = "up-next", includeSpotlight = true }) {
    const favoriteIds = favoriteTeamIds.map(value => String(value).toUpperCase());
    const allCandidates = deduplicate([...leagueGames, ...favoriteGames].map(toCandidate).filter(candidate => candidate.id));
    const favoriteCandidates = allCandidates.filter(candidate => candidate.teamKeys.some(key => favoriteIds.includes(String(key).toUpperCase())));
    const liveFavorite = favoriteIds
      .map(teamId => ({ teamId, candidate: favoriteCandidates.find(item => item.state === "live" && item.teamKeys.includes(teamId)) }))
      .filter(entry => entry.candidate)
      .find(Boolean);
    if (liveFavorite) return [{ kind: "favorite-live", candidate: liveFavorite.candidate, featuredTeamId: liveFavorite.teamId }];

    const queue = [];
    const topFavoriteId = favoriteIds[0];
    const topFavoriteCandidates = favoriteGames.map(toCandidate)
      .filter(candidate => candidate.teamKeys.includes(topFavoriteId));
    const favorite = chooseFavoriteFallback(topFavoriteCandidates, fallbackMode);
    if (favorite) queue.push({ kind: "favorite", candidate: favorite, featuredTeamId: topFavoriteId });

    if (includeSpotlight) {
      const spotlight = chooseSpotlight(allCandidates, favoriteIds);
      if (spotlight && !queue.some(entry => entry.candidate.id === spotlight.id)) {
        queue.push({ kind: "spotlight", candidate: spotlight, featuredTeamId: null });
      }
    }
    return queue;
  }

  function chooseFavoriteFallback(candidates, fallbackMode) {
    if (fallbackMode === "hide") return null;
    if (fallbackMode === "recent-final") {
      return [...candidates].filter(candidate => candidate.state === "final")
        .sort((a, b) => dateValue(b.startTime) - dateValue(a.startTime))[0] ?? null;
    }
    return [...candidates].filter(candidate => candidate.state === "pregame")
      .sort((a, b) => dateValue(a.startTime) - dateValue(b.startTime))[0] ?? null;
  }

  function chooseSpotlight(candidates, favoriteTeamIds = []) {
    const excluded = new Set(favoriteTeamIds.map(value => String(value).toUpperCase()));
    return [...candidates]
      .filter(candidate => candidate.state === "live")
      .filter(candidate => !candidate.teamKeys.some(key => excluded.has(String(key).toUpperCase())))
      .sort((a, b) => interestScore(b) - interestScore(a) || dateValue(a.startTime) - dateValue(b.startTime) || a.id.localeCompare(b.id))[0] ?? null;
  }

  function applyRotationControls({ automaticEntries = [], availableEntries = [], mode = "automatic", includedGameKeys = [], excludedGameKeys = [], rotationOrder = [], keyOf = defaultEntryKey }) {
    const available = deduplicateEntries([...availableEntries, ...automaticEntries], keyOf);
    const automatic = deduplicateEntries(automaticEntries, keyOf);
    const byKey = new Map(available.map(entry => [keyOf(entry), entry]));
    const included = includedGameKeys.map(key => byKey.get(key)).filter(Boolean);
    const base = mode === "curated" ? included : mode === "hybrid" ? [...automatic, ...included] : automatic;
    const excluded = new Set(excludedGameKeys);
    const order = new Map(rotationOrder.map((key, index) => [key, index]));
    return deduplicateEntries(base, keyOf)
      .filter(entry => !excluded.has(keyOf(entry)))
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const aOrder = order.has(keyOf(a.entry)) ? order.get(keyOf(a.entry)) : Number.MAX_SAFE_INTEGER;
        const bOrder = order.has(keyOf(b.entry)) ? order.get(keyOf(b.entry)) : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder || a.index - b.index;
      })
      .map(item => item.entry);
  }

  function applyGameLocks(entries = [], lockedGameKeys = [], keyOf = defaultEntryKey) {
    const locked = new Set(lockedGameKeys);
    const lockedEntries = entries.filter(entry => locked.has(keyOf(entry)));
    return lockedEntries.length ? lockedEntries : entries;
  }

  function retainAutoFinals(previousEntries = [], automaticEntries = [], availableEntries = [], {
    keyOf = defaultEntryKey, now = Date.now(), retentionMs = 60 * 60 * 1_000,
  } = {}) {
    const retained = [...automaticEntries];
    const selectedKeys = new Set(retained.map(keyOf));
    const availableByKey = new Map(availableEntries.map(entry => [keyOf(entry), entry]));
    previousEntries.forEach(previous => {
      const key = keyOf(previous);
      const current = availableByKey.get(key);
      if (!current || current.candidate?.state !== "final" || selectedKeys.has(key)) return;
      const wasLive = ["live", "interrupted"].includes(previous.candidate?.state);
      const retainUntil = wasLive ? now + retentionMs : previous.autoRetainUntil;
      if (!Number.isFinite(retainUntil) || retainUntil <= now) return;
      retained.push({
        ...current,
        kind: previous.kind,
        featuredTeamId: previous.featuredTeamId,
        autoRetainUntil: retainUntil,
      });
      selectedKeys.add(key);
    });
    return retained;
  }

  function deduplicateEntries(entries, keyOf) {
    const seen = new Set();
    return entries.filter(entry => {
      const key = keyOf(entry);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function defaultEntryKey(entry) {
    return entry?.candidate?.sport && entry?.candidate?.id ? `${entry.candidate.sport}:${entry.candidate.id}` : "";
  }

  function gameDurationSeconds(entry, overrides = {}, keyOf = defaultEntryKey, defaults = {}) {
    const override = Number(overrides?.[keyOf(entry)]);
    if (Number.isFinite(override)) return Math.min(300, Math.max(5, Math.round(override / 5) * 5));
    const state = entry?.candidate?.state;
    const timingState = state === "live" || state === "interrupted" ? "live" : state === "final" ? "final" : "pregame";
    const seconds = defaults?.[timingState];
    return typeof seconds === "number" && Number.isFinite(seconds)
      ? Math.min(300, Math.max(5, Math.round(seconds / 5) * 5))
      : { live: 20, pregame: 5, final: 10 }[timingState];
  }

  function interestScore(candidate) {
    let score = 0;
    if (candidate.postseason) score += 100;
    if (candidate.nationalBroadcast) score += 40;
    candidate.rankings.forEach(rank => { score += 26 - rank; });
    if (candidate.rankings.length >= 2) score += 20;
    if (candidate.spread !== null) score += Math.max(0, 25 - Math.abs(candidate.spread) * 3);
    if (candidate.scoreMargin !== null) {
      const scale = { baseball: 6, hockey: 7, soccer: 8, football: 1.5, "college-football": 1.5, basketball: 0.75, "college-basketball": 0.75 }[candidate.sport] ?? 2;
      score += Math.max(0, 20 - candidate.scoreMargin * scale);
      score += Math.min(10, Math.max(0, Number(candidate.period || 0)));
    }
    return score;
  }

  function deduplicate(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    });
  }

  function normalizeState(state) {
    const value = String(state || "").toLowerCase();
    if (value === "in" || value === "live") return "live";
    if (value === "post" || value === "final") return "final";
    return "pregame";
  }

  function dateValue(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.selection = Object.freeze({
    espnCandidate,
    mlbCandidate,
    buildRotationQueue,
    applyRotationControls,
    applyGameLocks,
    retainAutoFinals,
    gameDurationSeconds,
    chooseSpotlight,
    interestScore,
  });
})(typeof window === "undefined" ? globalThis : window);
