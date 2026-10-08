const watch = { tournamentId: 'season', bannerId: 'board', view: 'leaderboard', leaderboardSize: 10, enabled: true, name: 'F1 leaderboard' };
function fixture(phase = 'live') {
  const state = phase === 'final' ? 'post' : phase === 'pregame' ? 'pre' : 'in';
  const competitions = [{ id: '101', date: '2026-10-09T09:00Z', type: { abbreviation: 'FP1', text: 'Free Practice 1' },
    status: { type: { state, completed: state === 'post', description: state === 'in' ? 'Live' : state === 'post' ? 'Final' : 'Scheduled' } } },
    { id: '102', date: '2026-10-10T09:00Z', type: { abbreviation: 'Qual', text: 'Qualifying' }, status: { type: { state: 'pre' } } },
    { id: '103', date: '2026-10-11T09:00Z', type: { abbreviation: 'Race', text: 'Race' }, status: { type: { state: 'pre' } } }];
  const scoreboard = { events: [{ id: '60001', name: 'Coastal Grand Prix', competitions }], leagues: [{ calendar: [] }] };
  const content = { gamepackage: { raceStrip: { data: { sessions: competitions.map(c => ({ session: c.type.text, sessionAbbrev: c.type.abbreviation, date: c.date, statusState: c.status.type.state, completed: c.status.type.completed })) } },
    filteredPositions: state === 'pre' ? [] : [{ competitionId: '101', title: 'Free Practice 1', sessionState: state, data: Array.from({ length: 22 }, (_, i) => ({
      position: i + 1, order: i + 1, lapsCompleted: '12', raceTime: i ? '--' : '1:20.123', timeBehindLeader: i ? `+${i}.123` : '1:20.123',
      athlete: { displayName: `Driver ${i + 1}`, team: 'Demo Racing', logo: 'https://a.espncdn.com/i/teamlogos/countries/500/gbr.png', country: 'Britain', links: `https://www.espn.com/racing/driver/_/id/${1000 + i}/driver-${i + 1}` },
    })) }] } };
  return { scoreboard, content, watch: { ...watch } };
}
module.exports = { fixture, watch };
