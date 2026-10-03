function bannerUrl(value) {
  if (typeof value !== 'string') throw Error('Invalid banner link');
  const url = new URL(value);
  const chess = url.hostname === 'lichess.org' && url.pathname.startsWith('/broadcast/');
  const pdga = url.hostname === 'www.pdga.com' && (
    /^\/(?:tour\/event|player)\/[1-9]\d{0,8}\/?$/.test(url.pathname)
    || /^\/live\/event\/[1-9]\d{0,8}\/[A-Z0-9]{2,8}\/scores\/?$/.test(url.pathname));
  const espn = url.hostname === 'www.espn.com' && /^\/(?:nfl|college-football|nba|mens-college-basketball|nhl|soccer)\/(?:game|match|boxscore)\/_\/gameId\/[1-9]\d*(?:\/[a-zA-Z0-9-]+)?\/?$/.test(url.pathname);
  const mlb = url.hostname === 'www.mlb.com' && /^\/gameday\/[1-9]\d*\/?$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !(chess || pdga || espn || mlb)) throw Error('Invalid banner link');
  return url.href;
}
module.exports = { bannerUrl };
