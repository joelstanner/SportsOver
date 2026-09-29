import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_OVERRIDES = new Map([
  ["mlb:136", { primary: "#0c2c56", accent: "#005c5c" }],
  ["nfl:sea", { primary: "#002244", accent: "#69be28" }],
  ["ncaaf:158", { primary: "#050505", accent: "#e41c38" }],
  ["ncaaf:264", { primary: "#4b2e83", accent: "#b7a57a" }],
  ["nhl:sea", { primary: "#001628", accent: "#99d9d9" }],
  ["mls:9726", { primary: "#236192", accent: "#6ab43e" }],
]);
const ESPN_SPORTS = Object.freeze([
  { sport: "football", league: "NFL", provider: "espn-nfl", keyPrefix: "nfl", apiSport: "football", apiLeague: "nfl", logoLeague: "nfl", identity: "abbreviation", limit: 100 },
  { sport: "college-football", league: "NCAAF", provider: "espn-ncaaf", keyPrefix: "ncaaf", apiSport: "football", apiLeague: "college-football", logoLeague: "ncaa", identity: "string-id", limit: 2000 },
  { sport: "hockey", league: "NHL", provider: "espn-nhl", keyPrefix: "nhl", apiSport: "hockey", apiLeague: "nhl", logoLeague: "nhl", identity: "abbreviation", limit: 100 },
  { sport: "soccer", league: "MLS", provider: "espn-mls", keyPrefix: "mls", apiSport: "soccer", apiLeague: "usa.1", logoLeague: "soccer", identity: "number-id", limit: 100 },
  { sport: "basketball", league: "NBA", provider: "espn-nba", keyPrefix: "nba", apiSport: "basketball", apiLeague: "nba", logoLeague: "nba", identity: "abbreviation", limit: 100 },
]);

export const SUPPORTED_SPORTS = Object.freeze(["baseball", ...ESPN_SPORTS.map(item => item.sport)]);

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function color(value, fallback) {
  return `#${String(value || fallback).toLowerCase()}`;
}

function catalog(metadata, teams) {
  return {
    ...metadata,
    updatedAt: new Date().toISOString().slice(0, 10),
    teams: teams.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  };
}

function theme(key, primary, accent) {
  return BRAND_OVERRIDES.get(key) || { primary: color(primary, "071b2c"), accent: color(accent, "31556f") };
}

async function writeCatalog(sport, value) {
  const path = resolve(root, "sports", sport, "teams.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return { sport, count: value.teams.length, updatedAt: value.updatedAt };
}

async function updateMlb() {
  const [mlb, espn] = await Promise.all([
    fetchJson("https://statsapi.mlb.com/api/v1/teams?sportId=1"),
    fetchJson("https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=100"),
  ]);
  const espnTeams = espn.sports?.[0]?.leagues?.[0]?.teams?.map(entry => entry.team) ?? [];
  const aliases = new Map([["CWS", "CHW"]]);
  const branding = new Map(espnTeams.map(team => [team.abbreviation, team]));
  const teams = (mlb.teams ?? []).map(team => {
    const brand = branding.get(aliases.get(team.abbreviation) || team.abbreviation) || {};
    const key = `mlb:${team.id}`;
    return {
      key,
      teamId: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      theme: theme(key, brand.color, brand.alternateColor),
      logoUrl: `https://www.mlbstatic.com/team-logos/${team.id}.svg`,
    };
  });
  return writeCatalog("baseball", catalog({ sport: "baseball", league: "MLB", provider: "mlb" }, teams));
}

function espnIdentity(team, metadata) {
  if (metadata.identity === "number-id") return { teamId: Number(team.id), keyId: team.id, logoId: team.id };
  if (metadata.identity === "string-id") return { teamId: team.id, keyId: team.id, logoId: team.id };
  const abbreviation = String(team.abbreviation || "").toLowerCase();
  return { teamId: team.abbreviation, keyId: abbreviation, logoId: abbreviation };
}

async function updateEspnSport(metadata) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${metadata.apiSport}/${metadata.apiLeague}/teams?limit=${metadata.limit}`;
  const payload = await fetchJson(url);
  const sourceTeams = payload.sports?.[0]?.leagues?.[0]?.teams?.map(entry => entry.team) ?? [];
  const teams = sourceTeams.map(team => {
    const identity = espnIdentity(team, metadata);
    const key = `${metadata.keyPrefix}:${identity.keyId}`;
    return {
      key,
      teamId: identity.teamId,
      name: team.displayName,
      abbreviation: team.abbreviation,
      theme: theme(key, team.color, team.alternateColor),
      logoUrl: `https://a.espncdn.com/i/teamlogos/${metadata.logoLeague}/500/${identity.logoId}.png`,
    };
  });
  return writeCatalog(metadata.sport, catalog({ sport: metadata.sport, league: metadata.league, provider: metadata.provider }, teams));
}

export async function updateCatalogs(selection = "all") {
  const sports = selection === "all" ? SUPPORTED_SPORTS : [selection];
  if (sports.some(sport => !SUPPORTED_SPORTS.includes(sport))) throw new Error(`Unsupported sport: ${selection}`);
  return Promise.all(sports.map(sport => sport === "baseball"
    ? updateMlb()
    : updateEspnSport(ESPN_SPORTS.find(item => item.sport === sport))));
}
