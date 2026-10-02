function broadcastUrl(value) {
  if (typeof value !== 'string') throw Error('Invalid broadcast link');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'lichess.org' || url.port || url.username || url.password
      || !url.pathname.startsWith('/broadcast/')) throw Error('Invalid broadcast link');
  return url.href;
}
module.exports = { broadcastUrl };
