"use strict";
(function initializeLichess(global) {
  const DIRECTORY_INTERVAL = 15 * 60_000;
  const LIVE_SCAN_LIMIT = 12, LIVE_SUGGESTION_LIMIT = 8;
  const BASE = "https://lichess.org/api/broadcast/";
  const validId = value => /^[a-zA-Z0-9]{8}$/.test(String(value || ""));
  const numeric = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  const completed = round => Boolean(round.finishedAt || round.finished);
  function tournamentState(metadata) {
    return metadata?.rounds?.length && metadata.rounds.every(completed) ? "final"
      : metadata?.rounds?.some(round => round.ongoing && !completed(round)) ? "live" : "pregame";
  }
  const isWatchEnabled = watch => global.SportsOverlay.config.isWatchEnabled(watch);
  const watchId = watch => global.SportsOverlay.config.watchId(watch);
  const iso = value => numeric(value) !== null && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null;
  function reference(value) {
    const text = String(value || "").trim();
    if (validId(text)) return { id: text, round: false };
    try {
      const url = new URL(text);
      if (url.protocol !== "https:" || url.hostname !== "lichess.org") return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "broadcast" || ![3, 4, 5].includes(parts.length)) return null;
      const round = parts.length >= 4, id = parts[round ? 3 : 2];
      return validId(id) ? { id, round } : null;
    } catch (_) { return null; }
  }
  function selectRound(metadata, roundId = "", now = Date.now()) {
    const rounds = metadata.rounds || [];
    if (roundId) return rounds.find(round => round.id === roundId) || null;
    const dated = rounds.filter(round => numeric(round.startsAt) !== null && round.startsAt <= now);
    return [...rounds].reverse().find(round => round.ongoing && !completed(round))
      || [...dated].sort((a, b) => b.startsAt - a.startsAt).find(round => !completed(round))
      || rounds.filter(round => numeric(round.startsAt) !== null && round.startsAt > now && !completed(round))
        .sort((a, b) => a.startsAt - b.startsAt)[0]
      || [...rounds].reverse().find(completed)
      || rounds.find(round => round.id === metadata.defaultRoundId) || rounds[0] || null;
  }
  function gameState(game, round) {
    if (completed(round) || ["1-0", "0-1", "½-½", "1/2-1/2"].includes(game.status)) return "final";
    // An ongoing round can contain only unstarted pairings. A recorded move
    // on an unfinished board is evidence of play; the round flag alone isn't.
    return game.lastMove ? "live" : "pregame";
  }
  function roundState(payload) {
    const round = payload?.round || {}, games = payload?.games || [];
    if (completed(round) || (games.length && games.every(game => gameState(game, round) === "final"))) return "final";
    if (games.some(game => gameState(game, round) === "live")) return "live";
    return games.some(game => gameState(game, round) === "final") ? "interrupted" : "pregame";
  }
  function normalizePlayer(player = {}, color) {
    return { id: player.fideId ? `fide:${player.fideId}` : `name:${String(player.name || "Player")}`,
      name: String(player.name || "Player"), color, title: String(player.title || ""),
      rating: numeric(player.rating), federation: String(player.fed || ""), clock: numeric(player.clock) };
  }
  // Published broadcast totals include Lichess custom scoring and tiebreak ranks.
  // Never infer tournament standings by adding the currently visible boards.
  function normalizeStandings(value) {
    if (!Array.isArray(value)) throw Error("Lichess standings unavailable");
    return value.filter(person => person && typeof person === "object" && numeric(person.score) !== null)
      .map(person => ({ ...normalizePlayer(person), score: numeric(person.score),
        rank: numeric(person.rank), played: numeric(person.played) }))
      .sort((a, b) => b.score - a.score || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  }
  function normalizeEvent(metadata, payload, watch, now = Date.now()) {
    if (!validId(metadata?.tour?.id) || !validId(payload?.round?.id) || !Array.isArray(payload.games)) throw Error("Lichess returned an invalid broadcast feed");
    const round = payload.round;
    const games = payload.games.map((game, index) => ({ id: String(game.id), board: index + 1,
      players: [normalizePlayer(game.players?.[0], "white"), normalizePlayer(game.players?.[1], "black")],
      state: gameState(game, round), result: ["1-0", "0-1", "½-½", "1/2-1/2"].includes(game.status) ? game.status.replace("1/2-1/2", "½-½") : "",
      turn: ({ w: "white", b: "black" })[String(game.fen || "").split(" ")[1]] || null,
      move: Number(String(game.fen || "").split(" ")[5]) || null, lastMove: String(game.lastMove || ""),
    }));
    const reportedState = roundState(payload), index = metadata.rounds.findIndex(item => item.id === round.id);
    const scheduledAhead = numeric(round.startsAt) !== null && round.startsAt > now;
    // A future round may already contain results from games played in advance.
    // Keep the remaining pairings upcoming unless a board is actually live.
    const current = scheduledAhead && reportedState === "interrupted" ? "pregame" : reportedState;
    const betweenRounds = !watch.roundId && ((current === "final" && index >= 0 && index < metadata.rounds.length - 1)
      || (current === "pregame" && !scheduledAhead
        && metadata.rounds.slice(0, Math.max(0, index)).some(completed)));
    const state = betweenRounds ? "interrupted" : current;
    const breakReason = current === "final" ? "Round complete"
      : current === "pregame" ? `Awaiting ${round.name || "next round"}` : "Awaiting remaining games";
    return global.SportsOverlay.model.createEvent({ id: watchId(watch), sport: "chess", league: "Lichess", competitionType: "individual",
      state, detailedState: state === "interrupted" ? breakReason : state === "final" ? "Final" : state === "live" ? "Live" : "Upcoming",
      startTime: iso(round.startsAt), competitors: games.flatMap(game => game.players),
      details: { tournamentId: metadata.tour.id, roundId: round.id, name: metadata.tour.name || watch.name,
        roundName: round.name || "Round", games, view: watch.view || "overview", playerId: watch.playerId || "", leaderboardSize: watch.leaderboardSize === 3 ? 3 : 10,
        timeControl: String(metadata.tour.info?.tc || ""), delay: numeric(round.delay), stale: false, automatic: watch.automatic === true,
        discoveryTier: watch.discoveryTier, discoveryReason: watch.discoveryReason,
        roundUrl: `https://lichess.org/broadcast/-/-/${round.id}`, lastPlay: "" } });
  }
  function toCandidate(event) {
    const player = event.details.view === "player"
      ? [...event.competitors, ...(event.details.standings || [])].find(player => player.id === event.details.playerId) : null;
    return { id: event.id, sport: "chess", competitionType: "individual", state: event.state, startTime: event.startTime,
      teamKeys: [], competitorKeys: event.competitors.map(player => player.id),
      raw: { name: event.details.name, bannerLabel: event.details.view === "player"
        ? `Player · ${player?.name || (event.details.playerId ? "Player unavailable" : "Choose a player")}`
        : event.state === "live" && event.details.games.length ? "Live round matchups" : `Top ${event.details.leaderboardSize} players`, roundName: event.details.roundName, stale: event.details.stale, automatic: event.details.automatic, detailedState: event.detailedState,
        view: event.details.view,
        discoveryTier: event.details.discoveryTier, discoveryReason: event.details.discoveryReason } };
  }
  function createSession() { return { tail: Promise.resolve(), requests: new Map(), lastGood: new Map(), roundResults: new Map(), cooldownUntil: 0, directory: [], directoryAt: -Infinity, directoryPending: null, watches: new Map(), finishedAt: new Map(), activeWatches: new Set(), secondTier: new Map(), secondTierAt: -Infinity, secondTierPending: null }; }
  function secondTierStrength(event) {
    const players = [...new Map(event.competitors.map(player => [player.id, player])).values()];
    const grandmasters = players.filter(player => ["GM", "WGM"].includes(player.title)).length;
    const masters = players.filter(player => ["GM", "WGM", "IM", "WIM"].includes(player.title)).length;
    return { qualifies: grandmasters >= 2 || masters >= 4, rank: grandmasters * 1000 + masters,
      reason: `Official broadcast · ${grandmasters} GM/WGM · ${masters} GM/WGM/IM/WIM in broadcast field` };
  }
  function eliteEvents(directory, now) {
    const day = 86400_000, seen = new Set();
    return directory.filter(tour => {
      const start = tour.dates?.[0], end = tour.dates?.at(-1) ?? start;
      if (!validId(tour.id) || ![4, 5].includes(tour.tier) || seen.has(tour.id)
        || (numeric(start) !== null && start > now + 7 * day)
        || (numeric(end) !== null && end < now - 7 * day)) return false;
      seen.add(tour.id); return true;
    }).sort((a, b) => b.tier - a.tier
      || Math.abs((a.dates?.[0] ?? now) - now) - Math.abs((b.dates?.[0] ?? now) - now)
      || a.id.localeCompare(b.id)).slice(0, 8);
  }
  const defaultSession = createSession();
  function createClient({ watches = [], autoFollow = false, discoverSecondTier = false, session = defaultSession, fetchImpl = global.fetch.bind(global), now = Date.now, requestTimeoutMs = 8000 } = {}) {
    // Lichess asks clients to serialize requests and pause for a minute on 429.
    function requestUrl(path) {
      return path.startsWith("/broadcast/")
        ? global.location?.protocol === "sportsover:" ? `/api/chess${path}` : `https://lichess.org${path}`
        : BASE + path;
    }
    async function get(path, options = {}) {
      const url = requestUrl(path);
      if (session.requests.has(url)) {
        if (options.priority === 'display') fetchImpl.prioritize?.(url);
        return session.requests.get(url);
      }
      const pending = session.tail.catch(() => {}).then(async () => {
        if (now() < session.cooldownUntil) throw Error("Lichess rate limit · waiting before retrying");
        try {
          const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs), requestTimeoutMs });
          if (!response.ok) {
            const error = Error(`Lichess returned HTTP ${response.status}`); error.status = response.status;
            const retry = response.headers?.get("Retry-After");
            if (retry) error.retryAfterMs = /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now()) || 0;
            throw error;
          }
          return response.json();
        } catch (error) {
          // The shared refresh cache throws for HTTP errors instead of returning
          // a Response. Both paths must stop all remaining Lichess requests.
          if (error.status === 429) session.cooldownUntil = Math.max(session.cooldownUntil,
            error.retryAt ?? now() + Math.max(60_000, error.retryAfterMs || 0));
          throw error;
        }
      });
      session.tail = pending; session.requests.set(url, pending);
      try { return await pending; } finally { session.requests.delete(url); }
    }
    async function getMetadata(id, options) {
      if (!validId(id)) throw Error("Enter a valid Lichess broadcast ID");
      const value = await get(id, options);
      if (!validId(value.tour?.id) || !Array.isArray(value.rounds)) throw Error("Public Lichess tournament not found");
      return value;
    }
    async function getRound(id, options) {
      if (!validId(id)) throw Error("Invalid Lichess round ID");
      const value = await get(`-/-/${id}`, options);
      if (!validId(value.round?.id) || !validId(value.tour?.id) || !Array.isArray(value.games)) throw Error("Lichess round unavailable");
      return value;
    }
    async function getStandings(id, options) {
      if (!validId(id)) throw Error("Invalid Lichess tournament ID");
      return normalizeStandings(await get(`/broadcast/${id}/players`, options));
    }
    async function resolve(value) {
      const ref = reference(value);
      if (!ref) throw Error("Enter a lichess.org broadcast link or an 8-character broadcast ID");
      if (ref.round) { const payload = await getRound(ref.id); return { metadata: await getMetadata(payload.tour.id), roundId: ref.id }; }
      try { return { metadata: await getMetadata(ref.id), roundId: "" }; }
      catch (error) {
        // Bare round IDs are useful too. Avoid further requests during cooldown.
        if (now() < session.cooldownUntil || error.status !== 404) throw error;
        const payload = await getRound(ref.id);
        return { metadata: await getMetadata(payload.tour.id), roundId: ref.id };
      }
    }
    async function listCurrentEvents() {
      if (!session.directoryPending && now() >= (session.directoryError ? session.directoryRetryAt : session.directoryAt + DIRECTORY_INTERVAL)) {
        session.directoryPending = (async () => {
          try {
            const value = await get("top");
            if (!Array.isArray(value.active)) throw Error("Lichess broadcast directory unavailable");
            session.directory = value.active.filter(item => validId(item.tour?.id)).map(item => ({ ...item.tour, currentRound: item.round }));
            session.directoryError = null;
          } catch (error) { session.directoryError = error; session.directoryRetryAt = Math.max(now() + 60_000, session.cooldownUntil); }
          finally { session.directoryAt = now(); session.directoryPending = null; }
        })();
      }
      if (session.directoryPending) await session.directoryPending;
      if (session.directoryError) throw session.directoryError;
      return session.directory;
    }
    async function loadEvent(watch, inspectedEvent, options = {}) {
      const id = watchId(watch);
      try {
        let event = inspectedEvent && structuredClone(inspectedEvent), metadata;
        if (!event) {
          metadata = await getMetadata(watch.tournamentId, options);
          const round = selectRound(metadata, watch.roundId, now());
          if (!round) { const error = Error("Selected chess round is unavailable"); error.missingRound = true; throw error; }
          event = normalizeEvent(metadata, await getRound(round.id, options), watch, now());
        }
        const roundFinished = event.state === "final" || event.detailedState === "Round complete"
          || (event.details.games.length > 0 && event.details.games.every(game => game.state === "final"));
        const results = JSON.stringify([roundFinished, event.details.games.filter(game => game.state === "final")
          .map(game => [game.id, game.result]).sort((a, b) => a[0].localeCompare(b[0]))]);
        const previous = session.roundResults.get(event.details.roundId);
        if (previous !== results) {
          fetchImpl.invalidate?.(requestUrl(`/broadcast/${watch.tournamentId}/players`));
          // A completed current round must advance without waiting for metadata TTL.
          if (!watch.roundId && roundFinished && metadata?.rounds.some(round => !completed(round))) {
            fetchImpl.invalidate?.(requestUrl(watch.tournamentId));
          }
          session.roundResults.set(event.details.roundId, results);
          if (session.roundResults.size > 128) session.roundResults.delete(session.roundResults.keys().next().value);
        }
        Object.assign(event.details, { discoveryTier: watch.discoveryTier, discoveryReason: watch.discoveryReason });
        if (watch.view !== "player" || !event.competitors.some(person => person.id === watch.playerId)) {
          // Tournament standings can still change after a watched older round ends.
          const cacheState = event.state === "live" ? "live" : metadata ? tournamentState(metadata) : event.state;
          try { event.details.standings = await getStandings(watch.tournamentId, { ...options, cacheState }); }
          catch (_) {
            event.details.standings = session.lastGood.get(id)?.details.standings || [];
            event.details.standingsUnavailable = true;
          }
        }
        session.lastGood.set(id, structuredClone(event));
        if (session.lastGood.size > 60) session.lastGood.delete(session.lastGood.keys().next().value);
        return event;
      } catch (error) {
        const cached = session.lastGood.get(id);
        if (!cached || error.missingRound) throw error;
        return { ...cached, details: { ...cached.details, stale: true, automatic: watch.automatic === true, discoveryTier: watch.discoveryTier, discoveryReason: watch.discoveryReason, view: watch.view, playerId: watch.playerId, leaderboardSize: watch.leaderboardSize === 3 ? 3 : 10 } };
      }
    }
    async function getEvent(id, _featuredTeamId, options) {
      const manual = watches.find(item => watchId(item) === id);
      const watch = manual || (autoFollow && session.watches.get(id)) || (discoverSecondTier && session.secondTier.get(id));
      if (!isWatchEnabled(watch)) throw Error("Chess tournament is not watched");
      return loadEvent(watch, undefined, options);
    }
    async function inspectLiveBroadcasts() {
      const inspected = new Map();
      let failures = 0;
      const found = [];
      // The website's live broadcasts are already in /top. Titles rank the
      // suggestions, but must not exclude live opens or computer tournaments.
      const candidates = session.directory.filter(tour => [3, 4, 5].includes(tour.tier)
        && tour.currentRound?.ongoing && !completed(tour.currentRound)
        && !watches.some(watch => watchId(watch) === `${tour.id}:auto`)
        && !(autoFollow && session.watches.has(`${tour.id}:auto`)))
        .sort((a, b) => (b.currentRound.startsAt || 0) - (a.currentRound.startsAt || 0) || a.id.localeCompare(b.id))
        .filter((tour, index, all) => all.findIndex(other => other.id === tour.id) === index).slice(0, LIVE_SCAN_LIMIT);
      for (const tour of candidates) {
        try {
          const metadata = await getMetadata(tour.id), round = selectRound(metadata, "", now());
          if (!round) continue;
          const watch = { tournamentId: tour.id, roundId: "", name: tour.name, enabled: true, view: "overview", playerId: "", automatic: true, discoveryTier: "second" };
          const event = normalizeEvent(metadata, await getRound(round.id), watch, now()), strength = secondTierStrength(event);
          if (![3, 4, 5].includes(metadata.tour.tier) || event.state !== "live") continue;
          found.push({ watch: { ...watch, discoveryTier: strength.qualifies ? "second" : "live",
            discoveryReason: strength.qualifies ? strength.reason : "Official Lichess broadcast · Unfinished games with recorded moves" }, rank: strength.rank });
          inspected.set(watchId(watch), event);
        } catch (_) { failures++; }
      }
      const next = found.sort((a, b) => b.rank - a.rank || watchId(a.watch).localeCompare(watchId(b.watch))).slice(0, LIVE_SUGGESTION_LIMIT).map(item => item.watch);
      if (failures) for (const watch of session.secondTier.values()) {
        if (next.length < LIVE_SUGGESTION_LIMIT && !next.some(item => watchId(item) === watchId(watch))) next.push(watch);
      }
      session.secondTier = new Map(next.map(watch => [watchId(watch), watch]));
      session.secondTierAt = now();
      session.secondTierRetryAt = failures ? Math.max(now() + 60_000, session.cooldownUntil) : 0;
      return { inspected, failures };
    }
    async function secondTierEvents() {
      if (!discoverSecondTier) return { events: [], failures: 0 };
      let inspected = new Map(), failures = 0;
      try { await listCurrentEvents(); } catch (_) { failures++; }
      if (!session.directoryError && !session.secondTierPending
        && now() >= (session.secondTierRetryAt || session.secondTierAt + DIRECTORY_INTERVAL)) {
        session.secondTierPending = inspectLiveBroadcasts().finally(() => { session.secondTierPending = null; });
      }
      if (session.secondTierPending) {
        const result = await session.secondTierPending;
        inspected = result.inspected; failures += result.failures;
      }
      const events = [];
      for (const watch of session.secondTier.values()) {
        if (watches.some(item => watchId(item) === watchId(watch))) continue;
        try { const event = await loadEvent(watch, inspected.get(watchId(watch))); failures += Number(event.details.stale); if (event.state === "live") events.push(event); }
        catch (_) { failures++; }
      }
      return { events, failures };
    }
    async function discover({ topFavoriteOnly = false, fallbackMode = "up-next", excludedKeys = [], retentionMs = 60 * 60_000 } = {}) {
      const manual = [], automatic = [], excluded = new Set(excludedKeys); let failures = 0;
      for (const watch of watches.filter(isWatchEnabled)) {
        try { const event = await loadEvent(watch); failures += Number(event.details.stale); manual.push(event); }
        catch (_) { failures++; }
      }
      const manualFailures = failures;
      const manualById = new Map(manual.map(event => [event.id, event]));
      let candidates = [];
      if (autoFollow) {
        try { await listCurrentEvents(); } catch (_) { failures++; }
        candidates = eliteEvents(session.directory, now());
        // Keep active tournaments through directory rollover and temporary outages.
        for (const [id, previous] of session.watches) {
          if (candidates.length >= 16) break;
          const cached = session.lastGood.get(id), finishedAt = session.finishedAt.get(id);
          if (cached && (["live", "interrupted"].includes(cached.state)
            || (finishedAt !== undefined && now() < finishedAt + retentionMs))
            && !candidates.some(tour => tour.id === previous.tournamentId)) {
            candidates.push({ id: previous.tournamentId, name: previous.name, tier: 5 });
          }
        }
      }
      // Publish all identities before awaiting feeds: banner updates run during discovery.
      session.watches = new Map(candidates.map(tour => {
        const watch = { tournamentId: tour.id, roundId: "", name: tour.name, enabled: true, view: "overview", playerId: "", automatic: true };
        return [watchId(watch), watch];
      }));
      for (const [id, watch] of session.watches) {
        const saved = watches.find(item => watchId(item) === id);
        if (saved && !isWatchEnabled(saved)) continue;
        try {
          const event = manualById.get(id) || await loadEvent(watch);
          if (!manualById.has(id)) failures += Number(event.details.stale);
          if (!event.details.stale) {
            if (event.state === "final") { if (session.activeWatches.has(id) && !session.finishedAt.has(id)) session.finishedAt.set(id, now()); }
            else { session.finishedAt.delete(id); if (["live", "interrupted"].includes(event.state)) session.activeWatches.add(id); }
          }
          automatic.push(event);
        } catch (_) { failures++; }
      }
      const secondTier = await secondTierEvents();
      const asEntry = event => ({ kind: event.details.automatic ? "automatic-event" : "watched-event", candidate: toCandidate(event) });
      const available = new Map(manual.map(event => [event.id, asEntry(event)]));
      automatic.forEach(event => { if (!available.has(event.id)) available.set(event.id, asEntry(event)); });
      secondTier.events.forEach(event => { if (!available.has(event.id)) available.set(event.id, asEntry(event)); });
      const eligible = automatic.filter(event => !excluded.has(`chess:${event.id}`));
      const active = eligible.filter(event => ["live", "interrupted"].includes(event.state));
      const retained = eligible.filter(event => event.state === "final" && session.finishedAt.has(event.id)
        && now() < session.finishedAt.get(event.id) + retentionMs);
      let selected = [...active, ...retained];
      if (!selected.length && fallbackMode === "up-next") selected = eligible.filter(event => event.state === "pregame")
        .sort((a, b) => Date.parse(a.startTime || "") - Date.parse(b.startTime || "")).slice(0, 1);
      if (!selected.length && fallbackMode === "recent-final") selected = eligible.filter(event => event.state === "final")
        .sort((a, b) => Date.parse(b.startTime || "") - Date.parse(a.startTime || "")).slice(0, 1);
      if (topFavoriteOnly) selected = selected.slice(0, 1);
      const firstWatch = watches.find(isWatchEnabled);
      const rotation = new Map((topFavoriteOnly ? manual.filter(event => event.id === watchId(firstWatch || {})) : manual).map(event => [event.id, asEntry(event)]));
      for (const event of selected) {
        const finish = session.finishedAt.get(event.id);
        rotation.set(event.id, { ...(rotation.get(event.id) || asEntry(event)),
          ...(event.state === "final" && finish !== undefined && now() < finish + retentionMs ? { autoRetainUntil: finish + retentionMs } : {}) });
      }
      for (const id of session.activeWatches) if (!session.watches.has(id)) { session.finishedAt.delete(id); session.activeWatches.delete(id); }
      return { failures: failures + secondTier.failures, availableEntries: [...available.values()], automaticEntries: [...rotation.values()],
        automaticWatches: autoFollow && !session.directoryError ? [...session.watches.values()].filter(watch => !watches.some(item => watchId(item) === watchId(watch))) : null,
        automaticWatchesComplete: failures === manualFailures };
    }
    return { getMetadata, getRound, getStandings, resolve, listCurrentEvents, getEvent, discover,
      get discoveryIntervalMs() {
        return Math.min(autoFollow || discoverSecondTier ? DIRECTORY_INTERVAL : Infinity,
          session.cooldownUntil > now() ? session.cooldownUntil - now() : Infinity,
          session.directoryError ? Math.max(1000, session.directoryRetryAt - now()) : Infinity,
          session.secondTierRetryAt ? Math.max(1000, session.secondTierRetryAt - now()) : Infinity);
      } };
  }
  const provider = { createClient, createSession, eliteEvents, reference, watchId, selectRound, gameState, roundState, normalizeEvent, normalizePlayer, normalizeStandings, toCandidate,
    failureBackoff: true, requestIntervalMs: 1000, rateLimitCooldownMs: 60_000,
    refreshIntervalMs(url, state, configuredDelay = 0, error) {
      if (String(url).endsWith("/top")) return error ? 60_000 : DIRECTORY_INTERVAL;
      if (String(url).includes("/-/-/")) return undefined;
      if (error) return configuredDelay;
      return Math.max(configuredDelay, state === "final" ? DIRECTORY_INTERVAL : state === "live" ? 120_000 : 300_000);
    },
    refreshState(payload, url) {
      if (String(url).endsWith("/players")) return "live";
      if (String(url).includes("/-/-/")) return payload ? roundState(payload) : "pregame";
      if (payload?.rounds) return tournamentState(payload);
      return "pregame";
    } };
  global.SportsOverlay.lichess = provider;
  global.SportsOverlay.registry?.registerProvider("lichess", provider);
})(typeof window === "undefined" ? globalThis : window);
