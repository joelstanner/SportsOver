"use strict";

(function initializePdga(global) {
  const BASE = "https://www.pdga.com/apps/tournament/live-api/";
  const CURRENT = "https://www.pdga.com/api/v1/feat/current-events/tournaments";
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
    return scores.some(score => flag(score.RoundStarted) || flag(score.HasRoundScore) || number(score.Played) > 0) ? "live" : "pregame";
  }
  function normalizeEvent(metadata, round, watch) {
    if (!metadata || !Array.isArray(round?.scores)) throw Error("PDGA returned an invalid score feed");
    const roundNumber = number(round.roundNumber) || number(round.scores[0]?.Round) || 1;
    const competitors = round.scores.map(normalizePlayer).sort((a, b) =>
      (a.place ?? Infinity) - (b.place ?? Infinity));
    const current = roundState(round.scores);
    // A completed intermediate round is a break, not a finished tournament.
    const finalRound = number(metadata.FinalRound) || number(metadata.Rounds);
    const state = current === "final" && (!finalRound || roundNumber < finalRound) ? "interrupted" : current;
    return global.SportsOverlay.model.createEvent({
      id: `${watch.tournamentId}:${watch.division}`, sport: "disc-golf", league: "PDGA", competitionType: "individual",
      state, detailedState: state === "interrupted" ? "Round complete" : state === "pregame" ? "Awaiting scores" : state === "final" ? "Final" : "Live",
      // PDGA provides dates without a guaranteed zone. Keep the date as display
      // metadata rather than inventing a UTC tee time for queue/preview labels.
      startTime: null, competitors,
      details: {
        tournamentId: watch.tournamentId, division: watch.division, round: roundNumber,
        name: metadata.SimpleName || metadata.Name || watch.name, dateRange: metadata.DateRange || metadata.StartDate || "",
        view: watch.view || "leaderboard", playerId: watch.playerId || "", layouts: round.layouts || [],
        stale: false,
      },
    });
  }
  function toCandidate(event) {
    return { id: event.id, sport: "disc-golf", competitionType: "individual", state: event.state, startTime: null,
      teamKeys: [], competitorKeys: event.competitors.map(player => player.pdgaNumber).filter(Boolean),
      raw: { name: event.details.name, division: event.details.division, round: event.details.round,
        dateRange: event.details.dateRange, stale: event.details.stale, detailedState: event.detailedState } };
  }
  function createClient({ watches = [], fetchImpl = global.fetch.bind(global), requestTimeoutMs = 8000 } = {}) {
    async function get(url) {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
      if (!response.ok) { const error = Error(`PDGA returned HTTP ${response.status}`); error.status = response.status; throw error; }
      return response.json();
    }
    async function getMetadata(tournamentId) {
      if (!/^[1-9]\d{0,8}$/.test(String(tournamentId))) throw Error("Enter a valid PDGA tournament ID");
      const response = await get(`${BASE}live_results_fetch_event?TournID=${tournamentId}`);
      if (!Array.isArray(response.data?.Divisions)) throw Error("PDGA tournament not found");
      if (response.data.ScoringFormat && response.data.ScoringFormat !== "S") throw Error("Only individual stroke-play PDGA events are supported");
      return response.data;
    }
    async function getRound(tournamentId, division, round) {
      const query = new URLSearchParams({ TournID: tournamentId, Division: division, Round: round });
      const response = await get(`${BASE}live_results_fetch_round?${query}`);
      if (!Array.isArray(response.data?.scores)) throw Error("PDGA round scores unavailable");
      return response.data;
    }
    async function getEvent(id) {
      const watch = watches.find(item => `${item.tournamentId}:${item.division}` === id);
      if (!watch) throw Error("PDGA tournament/division is not watched");
      try {
        const metadata = await getMetadata(watch.tournamentId);
        const division = metadata.Divisions.find(item => item.Division === watch.division);
        if (!division) throw Error("Selected PDGA division is unavailable");
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
        if (!cached) throw error;
        return { ...cached, details: { ...cached.details, stale: true, view: watch.view, playerId: watch.playerId } };
      }
    }
    async function discover({ topFavoriteOnly = false } = {}) {
      const enabled = watches.filter(watch => watch.enabled !== false);
      const results = [];
      // Limit concurrency for watched tournaments; UI normalization caps at 30.
      for (let index = 0; index < enabled.length; index += 3) {
        results.push(...await Promise.allSettled(enabled.slice(index, index + 3).map(watch => getEvent(`${watch.tournamentId}:${watch.division}`))));
      }
      const availableEntries = results.flatMap(result => result.status === "fulfilled" ? [{ kind: "watched-event", candidate: toCandidate(result.value) }] : []);
      const firstId = enabled[0] && `${enabled[0].tournamentId}:${enabled[0].division}`;
      return { availableEntries, automaticEntries: topFavoriteOnly ? availableEntries.filter(entry => entry.candidate.id === firstId) : availableEntries,
        failures: results.filter(result => result.status === "rejected" || result.value.details.stale).length };
    }
    return { getEvent, discover, getMetadata, getRound,
      async listCurrentEvents() {
        const value = await get(CURRENT);
        if (!Array.isArray(value)) throw Error("PDGA event directory unavailable");
        return value;
      },
    };
  }
  const provider = { createClient, normalizeEvent, normalizePlayer, toCandidate, roundState,
    failureBackoff: true,
    refreshState(payload, url) {
      if (String(url).includes("live_results_fetch_round")) return payload ? roundState(payload.data?.scores) : "live";
      return "pregame";
    },
  };
  global.SportsOverlay.pdga = provider;
  global.SportsOverlay.registry?.registerProvider("pdga", provider);
})(typeof window === "undefined" ? globalThis : window);
