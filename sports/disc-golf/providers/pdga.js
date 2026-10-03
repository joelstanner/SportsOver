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
      total: !status && (started || priorRound) ? number(score.ToPar) : null,
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
        stale: false, automatic: watch.automatic === true,
      },
    });
  }
  function toCandidate(event) {
    return { id: event.id, sport: "disc-golf", competitionType: "individual", state: event.state, startTime: null,
      teamKeys: [], competitorKeys: event.competitors.map(player => player.pdgaNumber).filter(Boolean),
      raw: { name: event.details.name, fullName: event.details.fullName, bannerLabel: event.details.view === "player"
        ? `Player · ${event.competitors.find(player => (player.pdgaNumber || player.id) === event.details.playerId)?.name || "Choose a player"}`
        : `Top ${event.details.leaderboardSize} players`, division: event.details.division, round: event.details.round,
        dateRange: event.details.dateRange, stale: event.details.stale, automatic: event.details.automatic, detailedState: event.detailedState } };
  }
  const DIRECTORY_INTERVAL = 15 * 60_000;
  function createSession() {
    return { directory: [], directoryAt: -Infinity, directoryPending: null,
      selected: null, watches: new Map(), requests: new Map(), active: 0, waiting: [] };
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
  function createClient({ watches = [], autoFollow = false, autoDivisions = ["MPO", "FPO"],
    session = createSession(), now = Date.now, fetchImpl = global.fetch.bind(global), requestTimeoutMs = 8000 } = {}) {
    // Share in-flight metadata across divisions and bound all requests, including
    // rendering requests that overlap discovery, to three per engine session.
    async function get(url) {
      if (session.requests.has(url)) return session.requests.get(url);
      const pending = (async () => {
        if (session.active >= 3) await new Promise(resolve => session.waiting.push(resolve));
        else session.active++;
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
          if (!response.ok) { const error = Error(`PDGA returned HTTP ${response.status}`); error.status = response.status; throw error; }
          return await response.json();
        } finally {
          const next = session.waiting.shift();
          if (next) next(); else session.active--;
        }
      })();
      session.requests.set(url, pending);
      try { return await pending; } finally { session.requests.delete(url); }
    }
    async function getMetadata(tournamentId) {
      if (!/^[1-9]\d{0,8}$/.test(String(tournamentId))) throw Error("Enter a valid PDGA tournament ID");
      const response = await get(`${BASE}live_results_fetch_event?TournID=${tournamentId}`);
      if (!Array.isArray(response.data?.Divisions)) throw Error("PDGA tournament not found");
      if (response.data.ScoringFormat && response.data.ScoringFormat !== "S") {
        const error = Error("Only individual stroke-play PDGA events are supported"); error.unsupported = true; throw error;
      }
      return response.data;
    }
    async function getRound(tournamentId, division, round) {
      const query = new URLSearchParams({ TournID: tournamentId, Division: division, Round: round });
      const response = await get(`${BASE}live_results_fetch_round?${query}`);
      if (!Array.isArray(response.data?.scores)) throw Error("PDGA round scores unavailable");
      return response.data;
    }
    async function getEvent(id) {
      const manual = watches.find(item => watchId(item) === id);
      const watch = manual || (autoFollow && session.watches.get(id));
      if (!isWatchEnabled(watch) || (!manual && !autoDivisions.includes(watch.division))) throw Error("PDGA tournament/division is not watched");
      return loadEvent(watch);
    }
    async function loadEvent(watch, metadataPromise) {
      const id = watchId(watch);
      try {
        const metadata = await (metadataPromise || getMetadata(watch.tournamentId));
        const division = metadata.Divisions.find(item => item.Division === watch.division);
        if (!division) { const error = Error("Selected PDGA division is unavailable"); error.unsupported = true; throw error; }
        const roundNumber = Math.max(1, number(division.LatestRound) || number(metadata.LatestRound) || 1);
        let round;
        try { round = await getRound(watch.tournamentId, watch.division, roundNumber); }
        catch (error) {
          // A posted division can exist before its first scorecard. Only a
          // missing first round with no prior scores is a scheduled event.
          if (error.status !== 404 || roundNumber !== 1 || number(metadata.HighestCompletedRound) > 0 || lastGood.get(id)?.competitors.length) throw error;
          round = { scores: [], layouts: [] };
        }
        const event = normalizeEvent(metadata, { ...round, roundNumber }, watch);
        lastGood.set(id, structuredClone(event));
        if (lastGood.size > 120) lastGood.delete(lastGood.keys().next().value);
        return event;
      } catch (error) {
        const cached = lastGood.get(id);
        if (!cached || error.unsupported) throw error;
        // Upcoming fields may have tee times but no scores to go stale. Keep
        // their normal status until a routine refresh detects play starting.
        return { ...cached, details: { ...cached.details, stale: cached.state !== "pregame", unavailable: true, automatic: watch.automatic === true, view: watch.view, playerId: watch.playerId, leaderboardSize: watch.leaderboardSize === 3 ? 3 : 10 } };
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
      const asEntry = event => ({ kind: event.details.automatic ? "automatic-event" : "watched-event", candidate: toCandidate(event) });
      const available = new Map(manual.map(event => [event.id, asEntry(event)]));
      for (const tournament of tournaments) for (const event of tournament.allEvents || tournament.events) {
        if (!available.has(event.id)) available.set(event.id, asEntry(event));
      }
      const firstWatch = watches.find(isWatchEnabled);
      const automatic = new Map((topFavoriteOnly ? manual.filter(event => event.id === watchId(firstWatch || {})) : manual)
        .map(event => [event.id, asEntry(event)]));
      for (const event of selected?.events || []) {
        automatic.set(event.id, { ...(automatic.get(event.id) || asEntry(event)),
          ...(session.selected.finishedAt !== null ? { autoRetainUntil: session.selected.finishedAt + retentionMs } : {}) });
      }
      return { availableEntries: [...available.values()], automaticEntries: [...automatic.values()], failures,
        automaticWatches: autoFollow && !session.directoryError ? [...session.watches.values()]
          .filter(watch => !watches.some(item => watchId(item) === watchId(watch)))
          .map(watch => ({ tournamentId: watch.tournamentId, division: watch.division, name: watch.name, enabled: true, view: "leaderboard", playerId: "" })) : null,
        automaticWatchesComplete: failures === manualFailures,
      };
    }
    return { getEvent, discover, getMetadata, getRound, listCurrentEvents, discoveryIntervalMs: autoFollow ? DIRECTORY_INTERVAL : Infinity };
  }

  const provider = { createClient, createSession, proTourEvents, watchId,
    refreshIntervalMs: url => String(url) === CURRENT ? DIRECTORY_INTERVAL : undefined, normalizeEvent, normalizePlayer, toCandidate, roundState,
    failureBackoff: state => state === "live",
    refreshState(payload, url) {
      if (String(url).includes("live_results_fetch_round")) return payload ? roundState(payload.data?.scores) : "pregame";
      return "pregame";
    },
  };
  global.SportsOverlay.pdga = provider;
  global.SportsOverlay.registry?.registerProvider("pdga", provider);
})(typeof window === "undefined" ? globalThis : window);
