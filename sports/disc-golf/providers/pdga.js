"use strict";

(function initializePdga(global) {
  const BASE = "https://www.pdga.com/apps/tournament/live-api/";
  const CURRENT = "https://www.pdga.com/api/v1/feat/current-events/tournaments";
  const isWatchEnabled = watch => global.SportsOverlay.config.isWatchEnabled(watch);
  const watchId = watch => global.SportsOverlay.config.watchId(watch);
  const lastGood = new Map();
  const number = value => value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const flag = value => value === true || value === 1 || value === "1" || value === "yes";

  function playerStatus(score) {
    const explicit = String(score.Status || score.RoundStatus || "").toUpperCase();
    if (["DQ", "DNF", "DNS", "WD"].includes(explicit)) return explicit;
    // PDGA uses 888 and 999 as DNF codes, not stroke totals.
    if ([888, 999].includes(number(score.RoundScore))) return "DNF";
    return "";
  }
  function normalizePlayer(score) {
    const status = playerStatus(score);
    const started = flag(score.RoundStarted) || flag(score.HasRoundScore) || number(score.Played) > 0;
    const priorRound = number(score.Round) > 1;
    const ranked = number(score.RunningPlace);
    return {
      id: String(score.ResultID ?? score.PDGANum ?? ""), pdgaNumber: String(score.PDGANum || ""),
      name: String(score.Name || `${score.FirstName || ""} ${score.LastName || ""}`).trim() || "Player",
      shortName: String(score.ShortName || score.Name || "Player"),
      rating: number(score.Rating) > 0 ? number(score.Rating) : null,
      place: !status && (started || priorRound) && ranked > 0 ? ranked : null,
      tied: flag(score.Tied), wonPlayoff: flag(score.WonPlayoff), status,
      // ParThruRound includes the live round; ToPar can be empty in round one
      // or contain only posted scores while the next round is in progress.
      total: !status && (started || priorRound) ? number(score.ParThruRound) ?? number(score.ToPar) : null,
      roundScore: !status && started ? number(score.RoundScore) : null,
      roundToPar: !status && started ? number(score.RoundtoPar) : null,
      played: number(score.Played), holes: number(score.Holes), completed: flag(score.Completed), started,
      teeTime: String(score.TeeTime || ""), layoutId: number(score.LayoutID),
      holeScores: Array.isArray(score.HoleScores) ? score.HoleScores.map(number) : [],
    };
  }
  function roundState(scores = []) {
    if (!scores.length) return "pregame";
    if (scores.every(score => flag(score.Completed) || playerStatus(score))) return "final";
    // Finished/DNF cards can still carry Played and RoundStarted (including
    // a DNF entered before the next round). Only unfinished players count.
    if (scores.some(score => !flag(score.Completed) && !playerStatus(score)
      && (flag(score.RoundStarted) || flag(score.HasRoundScore) || number(score.Played) > 0))) return "live";
    return scores.some(score => flag(score.Completed) && !playerStatus(score)) ? "interrupted" : "pregame";
  }
  function normalizeEvent(metadata, round, watch) {
    if (!metadata || !Array.isArray(round?.scores)) throw Error("PDGA returned an invalid score feed");
    const roundNumber = number(round.roundNumber) || number(round.scores[0]?.Round) || 1;
    const current = roundState(round.scores);
    // Before the first round, PDGA's feed is alphabetical. Seed the field by
    // player rating; once play starts, preserve authoritative tournament places.
    const competitors = round.scores.map(normalizePlayer).sort(current === "pregame" && roundNumber === 1
      ? (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name)
      : (a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
    // A completed intermediate round is a break, not a finished tournament.
    const finalRound = number(metadata.FinalRound) || number(metadata.Rounds);
    const state = (current === "final" && (!finalRound || roundNumber < finalRound))
      || (current === "pregame" && roundNumber > 1) ? "interrupted" : current;
    const breakReason = current === "final" ? "Round complete"
      : current === "pregame" ? `Awaiting round ${roundNumber}` : "Awaiting remaining players";
    return global.SportsOverlay.model.createEvent({
      id: watchId(watch), sport: "disc-golf", league: "PDGA", competitionType: "individual",
      state, detailedState: state === "interrupted" ? breakReason : state === "pregame" ? "Awaiting scores" : state === "final" ? "Final" : "Live",
      // PDGA provides dates without a guaranteed zone. Keep the date as display
      // metadata rather than inventing a UTC tee time for queue/preview labels.
      startTime: null, competitors,
      details: {
        tournamentId: watch.tournamentId, division: watch.division, round: roundNumber,
        name: metadata.SimpleName || metadata.Name || watch.name, dateRange: metadata.DateRange || metadata.StartDate || "",
        fullName: metadata.Name || metadata.SimpleName || watch.name,
        view: watch.view || "leaderboard", playerId: watch.playerId || "", leaderboardSize: watch.leaderboardSize === 3 ? 3 : 10, layouts: round.layouts || [],
        stale: false, automatic: watch.automatic === true, discoveryTier: watch.discoveryTier, discoveryReason: watch.discoveryReason,
      },
    });
  }
  function toCandidate(event) {
    const player = event.details.view === "player"
      ? event.competitors.find(player => (player.pdgaNumber || player.id) === event.details.playerId) : null;
    return { id: event.id, sport: "disc-golf", competitionType: "individual", state: event.state, startTime: null,
      teamKeys: [], competitorKeys: event.competitors.map(player => player.pdgaNumber).filter(Boolean),
      raw: { name: event.details.name, fullName: event.details.fullName, bannerLabel: event.details.view === "player"
        ? `Player · ${player?.name || (event.details.playerId ? "Player unavailable" : "Choose a player")}`
        : `Top ${event.details.leaderboardSize} players`, division: event.details.division, round: event.details.round,
        view: event.details.view, player: player ? {
          name: player.name, place: player.place, tied: player.tied, total: player.total, roundToPar: player.roundToPar,
          played: player.played, completed: player.completed, started: player.started, teeTime: player.teeTime, status: player.status,
        } : null,
        dateRange: event.details.dateRange, stale: event.details.stale, automatic: event.details.automatic, detailedState: event.detailedState,
        discoveryTier: event.details.discoveryTier, discoveryReason: event.details.discoveryReason } };
  }
  const DIRECTORY_INTERVAL = 15 * 60_000;
  const metadataUrl = tournamentId => `${BASE}live_results_fetch_event?TournID=${tournamentId}`;
  function metadataState(tournament) {
    if (!tournament) return "pregame";
    const states = tournament.metadata.Divisions.map(division => {
      const observed = tournament.divisions.get(division.Division);
      const latest = Math.max(1, number(division.LatestRound) || number(tournament.metadata.LatestRound) || 1);
      return observed?.round === latest ? observed.state : "pregame";
    });
    if (states.includes("live")) return "live";
    if (states.includes("interrupted")) return "interrupted";
    // One completed division cannot prove that the whole tournament is final.
    return states.length && states.every(state => state === "final") ? "final" : "pregame";
  }
  function createSession() {
    return { directory: [], directoryAt: -Infinity, directoryPending: null,
      selected: null, watches: new Map(), requests: new Map(), tournaments: new Map(), roundResults: new Map(),
      active: 0, waiting: [], secondTier: new Map(), secondTierAt: -Infinity };
  }
  function proTourEvents(directory, now) {
    const day = 86400_000;
    return directory.filter(item => /^[1-9]\d{0,8}$/.test(String(item.tournId))
      && ["ES", "M"].includes(String(item.tier).toUpperCase())
      && (!item.eventType || ["S", "E"].includes(item.eventType))
      && Date.parse(item.startDate) <= now + 7 * day
      && Date.parse(item.endDate || item.startDate) >= now - 7 * day)
      .sort((a, b) => (a.tier === "M" ? 0 : 1) - (b.tier === "M" ? 0 : 1)
        || Math.abs(Date.parse(a.startDate) - now) - Math.abs(Date.parse(b.startDate) - now)
        || String(a.tournId).localeCompare(String(b.tournId))).slice(0, 12);
  }
  function createClient({ watches = [], autoFollow = false, discoverSecondTier = false, autoDivisions = ["MPO", "FPO"],
    session = createSession(), now = Date.now, fetchImpl = global.fetch.bind(global), requestTimeoutMs = 8000 } = {}) {
    // Coordinated clients use the shared service queue; standalone clients retain
    // their three-request bound. Share in-flight metadata across divisions.
    const coordinated = typeof fetchImpl.prioritize === "function";
    async function get(url, requestOptions = {}) {
      if (session.requests.has(url)) {
        if (requestOptions.priority === "display") fetchImpl.prioritize?.(url);
        return session.requests.get(url);
      }
      const pending = (async () => {
        if (!coordinated && session.active >= 3) await new Promise(resolve => session.waiting.push(resolve));
        else if (!coordinated) session.active++;
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs), requestTimeoutMs,
            priority: requestOptions.priority, cacheState: requestOptions.cacheState });
          if (!response.ok) { const error = Error(`PDGA returned HTTP ${response.status}`); error.status = response.status; throw error; }
          return await response.json();
        } finally {
          if (!coordinated) {
            const next = session.waiting.shift();
            if (next) next(); else session.active--;
          }
        }
      })();
      session.requests.set(url, pending);
      try { return await pending; } finally { session.requests.delete(url); }
    }
    async function getMetadata(tournamentId, requestOptions = {}) {
      if (!/^[1-9]\d{0,8}$/.test(String(tournamentId))) throw Error("Enter a valid PDGA tournament ID");
      const response = await get(metadataUrl(tournamentId), { ...requestOptions,
        cacheState: metadataState(session.tournaments.get(String(tournamentId))) });
      if (!Array.isArray(response.data?.Divisions)) throw Error("PDGA tournament not found");
      if (response.data.ScoringFormat && response.data.ScoringFormat !== "S") {
        const error = Error("Only individual stroke-play PDGA events are supported"); error.unsupported = true; throw error;
      }
      const previous = session.tournaments.get(String(tournamentId));
      session.tournaments.set(String(tournamentId), { metadata: response.data, divisions: previous?.divisions || new Map() });
      if (session.tournaments.size > 120) session.tournaments.delete(session.tournaments.keys().next().value);
      return response.data;
    }
    async function getRound(tournamentId, division, round, requestOptions = {}) {
      const query = new URLSearchParams({ TournID: tournamentId, Division: division, Round: round });
      const response = await get(`${BASE}live_results_fetch_round?${query}`, requestOptions);
      if (!Array.isArray(response.data?.scores)) throw Error("PDGA round scores unavailable");
      return response.data;
    }
    async function getEvent(id, _featuredTeamId, requestOptions = {}) {
      const manual = watches.find(item => watchId(item) === id);
      const watch = manual || (autoFollow && session.watches.get(id)) || (discoverSecondTier && session.secondTier.get(id));
      if (!isWatchEnabled(watch) || (!manual && !autoDivisions.includes(watch.division))) throw Error("PDGA tournament/division is not watched");
      return loadEvent(watch, undefined, requestOptions);
    }
    async function loadEvent(watch, metadataPromise, requestOptions = {}) {
      const id = watchId(watch);
      try {
        const metadata = await (metadataPromise || getMetadata(watch.tournamentId, requestOptions));
        const division = metadata.Divisions.find(item => item.Division === watch.division);
        if (!division) { const error = Error("Selected PDGA division is unavailable"); error.unsupported = true; throw error; }
        const roundNumber = Math.max(1, number(division.LatestRound) || number(metadata.LatestRound) || 1);
        let round;
        try { round = await getRound(watch.tournamentId, watch.division, roundNumber, requestOptions); }
        catch (error) {
          // A posted division can exist before its first scorecard. Only a
          // missing first round with no prior scores is a scheduled event.
          if (error.status !== 404 || roundNumber !== 1 || number(metadata.HighestCompletedRound) > 0 || lastGood.get(id)?.competitors.length) throw error;
          round = { scores: [], layouts: [] };
        }
        const event = normalizeEvent(metadata, { ...round, roundNumber }, watch);
        const tournament = session.tournaments.get(String(watch.tournamentId));
        tournament?.divisions.set(watch.division, { round: roundNumber, state: event.state });
        const resultKey = `${watch.tournamentId}:${watch.division}:${roundNumber}`;
        const completed = roundState(round.scores) === "final";
        const previousResult = session.roundResults.get(resultKey);
        // A finished intermediate round may already have a new round posted.
        // Remember completion per round so a cached result does not repeatedly
        // expire metadata when the next round has not been published yet.
        const finalRound = number(metadata.FinalRound) || number(metadata.Rounds);
        if (completed && previousResult !== true && (!finalRound || roundNumber < finalRound)) {
          fetchImpl.invalidate?.(metadataUrl(watch.tournamentId));
        }
        session.roundResults.set(resultKey, completed);
        if (session.roundResults.size > 128) session.roundResults.delete(session.roundResults.keys().next().value);
        lastGood.set(id, structuredClone(event));
        if (lastGood.size > 120) lastGood.delete(lastGood.keys().next().value);
        return event;
      } catch (error) {
        const cached = lastGood.get(id);
        if (!cached || error.unsupported) throw error;
        // Upcoming fields may have tee times but no scores to go stale. Keep
        // their normal status until a routine refresh detects play starting.
        return { ...cached, details: { ...cached.details, stale: cached.state !== "pregame", unavailable: true, automatic: watch.automatic === true, discoveryTier: watch.discoveryTier, discoveryReason: watch.discoveryReason, view: watch.view, playerId: watch.playerId, leaderboardSize: watch.leaderboardSize === 3 ? 3 : 10 } };
      }
    }
    async function listCurrentEvents() {
      if (!session.directoryPending && now() >= session.directoryAt + DIRECTORY_INTERVAL) {
        session.directoryPending = (async () => {
          try {
            const value = await get(CURRENT);
            if (!Array.isArray(value)) throw Error("PDGA event directory unavailable");
            session.directory = value; session.directoryError = null;
          } catch (error) { session.directoryError = error; }
          finally { session.directoryAt = now(); session.directoryPending = null; }
        })();
      }
      if (session.directoryPending) await session.directoryPending;
      if (session.directoryError) throw session.directoryError;
      return session.directory;
    }
    async function secondTierEvents(metadataFor) {
      if (!discoverSecondTier || !autoDivisions.length) return { events: [], failures: 0 };
      let failures = 0;
      try { await listCurrentEvents(); } catch (_) { failures++; }
      if (!session.directoryError && now() >= session.secondTierAt + DIRECTORY_INTERVAL) {
        const found = [], day = 86400_000;
        const candidates = session.directory.filter(item => /^[1-9]\d{0,8}$/.test(String(item.tournId))
          && String(item.tier).toUpperCase().split("/")[0] === "A"
          && (!item.eventType || ["S", "E"].includes(item.eventType))
          && Date.parse(item.startDate) <= now() + day && Date.parse(item.endDate || item.startDate) >= now() - day)
          .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate) || String(a.tournId).localeCompare(String(b.tournId)))
          .filter((item, index, all) => all.findIndex(other => String(other.tournId) === String(item.tournId)) === index).slice(0, 12);
        for (const directory of candidates) {
          const id = String(directory.tournId);
          try {
            const metadata = await metadataFor(id);
            if (String(metadata.TierPro ?? metadata.RawTier ?? directory.tier).toUpperCase().split("/")[0] !== "A") continue;
            const entries = [];
            for (const division of metadata.Divisions.filter(item => ["MPO", "FPO"].includes(item.Division) && autoDivisions.includes(item.Division))) {
              const watch = { tournamentId: id, division: division.Division, name: metadata.SimpleName || metadata.Name || directory.officialName,
                enabled: true, view: "leaderboard", playerId: "", automatic: true, discoveryTier: "second" };
              const event = await loadEvent(watch, Promise.resolve(metadata));
              if (event.details.unavailable) { failures++; continue; }
              if (event.state !== "live") continue;
              const ratings = event.competitors.map(player => player.rating).filter(rating => rating > 0).sort((a, b) => b - a).slice(0, 5);
              const average = ratings.length ? Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) : 0;
              watch.discoveryReason = `Pro A-tier · ${watch.division}${average ? ` · top ${ratings.length} rated players average ${average}` : " · ratings unavailable"}`;
              // Compare division-relative field strength so FPO-only events remain competitive.
              entries.push({ watch, rank: average ? average - (watch.division === "FPO" ? 900 : 1000) : -Infinity });
            }
            if (entries.length) found.push({ entries, rank: Math.max(...entries.map(entry => entry.rank)), id });
          } catch (error) { if (!error.unsupported) failures++; }
        }
        const next = found.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id)).slice(0, 3).flatMap(item => item.entries.map(entry => entry.watch));
        if (failures) for (const watch of session.secondTier.values()) {
          const ids = new Set(next.map(item => item.tournamentId));
          if ((ids.has(watch.tournamentId) || ids.size < 3) && !next.some(item => watchId(item) === watchId(watch))) next.push(watch);
        }
        session.secondTier = new Map(next.map(watch => [watchId(watch), watch]));
        session.secondTierAt = now();
      }
      const events = [];
      for (const watch of session.secondTier.values()) {
        if (!autoDivisions.includes(watch.division) || watches.some(item => watchId(item) === watchId(watch))) continue;
        try {
          const event = await loadEvent(watch, metadataFor(watch.tournamentId));
          failures += Number(Boolean(event.details.unavailable));
          if (event.state === "live") events.push(event);
        } catch (_) { failures++; }
      }
      return { events, failures };
    }
    async function discover({ topFavoriteOnly = false, fallbackMode = "up-next", excludedKeys = [], retentionMs = 60 * 60_000 } = {}) {
      let failures = 0;
      const excluded = new Set(excludedKeys);
      const eligible = watch => !excluded.has(`disc-golf:${watch.tournamentId}:${watch.division}`)
        && !watches.some(item => watchId(item) === watchId(watch) && !isWatchEnabled(item));
      const divisions = ["MPO", "FPO"].filter(division => autoDivisions.includes(division));
      let candidates = [];
      if (autoFollow && divisions.length) {
        try { await listCurrentEvents(); } catch (_) { failures++; }
        candidates = proTourEvents(session.directory, now());
        // Keep following a selected event even when the directory rolls over.
        const retainedSelection = session.selected?.active && (session.selected.finishedAt === null
          || now() < session.selected.finishedAt + retentionMs);
        if (retainedSelection && !candidates.some(item => String(item.tournId) === session.selected.id)) candidates.unshift(session.selected.directory);
      } else { session.selected = null; session.watches.clear(); }
      const metadata = new Map();
      const metadataFor = id => {
        if (!metadata.has(id)) metadata.set(id, getMetadata(id));
        return metadata.get(id);
      };
      const manualResults = await Promise.allSettled(watches.filter(isWatchEnabled)
        .map(watch => loadEvent(watch, metadataFor(watch.tournamentId))));
      const manual = manualResults.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const manualFailures = manualResults.filter(result => result.status === "rejected" || result.value.details.stale).length;
      failures += manualFailures;
      const manualById = new Map(manual.map(event => [event.id, event]));
      session.watches.clear();
      const tournaments = await Promise.all(candidates.map(async directory => {
        const id = String(directory.tournId);
        let info, metadataError;
        try { info = await metadataFor(id); }
        catch (error) {
          if (error.unsupported) return { id, directory, events: [], unavailable: false };
          failures++; metadataError = error;
        }
        // A failed metadata refresh is not an empty division list. Keep cached
        // divisions for every eligible directory candidate, including finals
        // offered in Available games but not selected for automatic rotation.
        const targets = divisions.filter(division => info
          ? info.Divisions.some(item => item.Division === division) : lastGood.has(`${id}:${division}`))
          .map(division => ({ tournamentId: id, division, name: info?.SimpleName || info?.Name || directory.officialName,
            automatic: true, view: "leaderboard", playerId: "" }))
          .filter(watch => !watches.some(item => watchId(item) === watchId(watch) && !isWatchEnabled(item)));
        for (const watch of targets) session.watches.set(`${id}:${watch.division}`, watch);
        const results = await Promise.allSettled(targets.map(watch => manualById.get(`${id}:${watch.division}`)
          || loadEvent(watch, metadataError ? Promise.reject(metadataError) : Promise.resolve(info))));
        failures += results.filter(result => result.status === "rejected" || result.value.details.stale).length;
        const allEvents = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
        return { id, directory, allEvents, events: allEvents.filter(event => eligible({ tournamentId: id, division: event.details.division })),
          unavailable: Boolean(metadataError) || results.some((result, index) => eligible(targets[index]) && (result.status === "rejected" || result.value.details.unavailable)) };
      }));
      const active = tournament => tournament.events.some(event => ["live", "interrupted"].includes(event.state));
      const hasFinalScores = tournament => tournament.events.length > 0 && tournament.events.every(event => event.state === "final");
      const complete = tournament => !tournament.unavailable && hasFinalScores(tournament);
      let selected = tournaments.find(item => item.id === session.selected?.id);
      // Outages cannot prove completion or cause an active tournament to switch.
      // Reuse only eligible prior divisions if metadata itself is unavailable.
      if (selected?.unavailable && !selected.events.length) {
        selected.events = (session.selected.events || []).filter(event => divisions.includes(event.details.division)
          && eligible({ tournamentId: selected.id, division: event.details.division }))
          .map(event => ({ ...event, details: { ...event.details, unavailable: true, stale: event.state !== "pregame" } }));
        selected.allEvents = selected.events;
        for (const event of selected.events) session.watches.set(event.id, { tournamentId: selected.id, division: event.details.division,
          name: event.details.name, automatic: true, view: "leaderboard", playerId: "" });
      }
      let keep = false;
      if (selected && selected.events.length && session.selected.active) {
        if (complete(selected)) session.selected.finishedAt ??= now();
        else if (!selected.unavailable) session.selected.finishedAt = null;
        keep = session.selected.finishedAt === null || now() < session.selected.finishedAt + retentionMs;
      }
      if (!keep) {
        selected = tournaments.find(item => item.events.some(event => event.state === "live"))
          || tournaments.find(active)
          || (fallbackMode === "up-next" ? tournaments.filter(item => item.events.some(event => event.state === "pregame"))
            .sort((a, b) => Date.parse(a.directory.startDate) - Date.parse(b.directory.startDate))[0]
            : fallbackMode === "recent-final" ? tournaments.filter(hasFinalScores)
              .sort((a, b) => Date.parse(b.directory.endDate || b.directory.startDate) - Date.parse(a.directory.endDate || a.directory.startDate))[0] : null);
        session.selected = selected ? { id: selected.id, directory: selected.directory, active: active(selected), finishedAt: null } : null;
      }
      if (selected) {
        session.selected.active ||= active(selected);
        session.selected.events = selected.events;
      }
      const secondTier = await secondTierEvents(metadataFor);
      const asEntry = event => ({ kind: event.details.automatic ? "automatic-event" : "watched-event", candidate: toCandidate(event) });
      const available = new Map(manual.map(event => [event.id, asEntry(event)]));
      for (const tournament of tournaments) for (const event of tournament.allEvents || tournament.events) {
        if (!available.has(event.id)) available.set(event.id, asEntry(event));
      }
      for (const event of secondTier.events) if (!available.has(event.id)) available.set(event.id, asEntry(event));
      const firstWatch = watches.find(isWatchEnabled);
      const automatic = new Map((topFavoriteOnly ? manual.filter(event => event.id === watchId(firstWatch || {})) : manual)
        .map(event => [event.id, asEntry(event)]));
      for (const event of selected?.events || []) {
        automatic.set(event.id, { ...(automatic.get(event.id) || asEntry(event)),
          ...(session.selected.finishedAt !== null ? { autoRetainUntil: session.selected.finishedAt + retentionMs } : {}) });
      }
      return { availableEntries: [...available.values()], automaticEntries: [...automatic.values()], failures: failures + secondTier.failures,
        automaticWatches: autoFollow && !session.directoryError ? [...session.watches.values()]
          .filter(watch => !watches.some(item => watchId(item) === watchId(watch)))
          .map(watch => ({ tournamentId: watch.tournamentId, division: watch.division, name: watch.name, enabled: true, view: "leaderboard", playerId: "" })) : null,
        automaticWatchesComplete: failures === manualFailures,
      };
    }
    return { getEvent, discover, getMetadata, getRound, listCurrentEvents, discoveryIntervalMs: autoFollow || discoverSecondTier ? DIRECTORY_INTERVAL : Infinity };
  }

  const provider = { createClient, createSession, proTourEvents, watchId,
    refreshIntervalMs(url, state, configuredDelay = 0, error) {
      if (String(url) === CURRENT) return DIRECTORY_INTERVAL;
      if (!String(url).startsWith(`${BASE}live_results_fetch_event?`) || error) return undefined;
      return Math.max(configuredDelay, state === "final" ? DIRECTORY_INTERVAL : state === "live" ? 120_000 : 300_000);
    }, normalizeEvent, normalizePlayer, toCandidate, roundState,
    failureBackoff: state => state === "live",
    refreshState(payload, url) {
      if (String(url).includes("live_results_fetch_round")) return payload ? roundState(payload.data?.scores) : "pregame";
      return "pregame";
    },
  };
  global.SportsOverlay.pdga = provider;
  global.SportsOverlay.registry?.registerProvider("pdga", provider);
})(typeof window === "undefined" ? globalThis : window);
