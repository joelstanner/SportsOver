function fitBounds(saved = {}, displays) {
  const areas = displays.map(display => display.workArea);
  const initial = areas[0];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const width = finite(saved.width) ? Math.max(236, Math.min(1416, saved.width)) : 472;
  const height = Math.round(width * 100 / 472);
  const x = finite(saved.x) ? saved.x : initial.x + 24;
  const y = finite(saved.y) ? saved.y : initial.y + 24;
  const area = areas.find(a => x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y) || initial;
  const w = Math.round(Math.min(width, area.width, area.height * 472 / 100));
  const h = Math.round(w * 100 / 472);
  return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - w))), y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - h))), width: w, height: h };
}
module.exports = { fitBounds };
