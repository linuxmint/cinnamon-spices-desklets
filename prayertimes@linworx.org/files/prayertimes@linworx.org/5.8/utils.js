var capitalise = s => {
  return [s.slice(0, 1).toUpperCase(), s.slice(1)].join('');
};

var formatTime = date => timeString(date ? date.getHours() : null, date ? date.getMinutes() : null);

var roundTime = t => {
  let hrs = Math.floor(t / 3600) * -1;
  const min = Math.abs(Math.floor((t % 3600) / 60));
  const sec = Math.abs(Math.floor(t % 60));

  if (t < 0) hrs = hrs - 1;
  return timeString(hrs, min, sec);
  // return `${(t >= 0 ? hrs : hrs - 1).toString()}:${(t >= 0 ? min : min - 1).toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

const timeString = (h, m, s) => {
  const elems = [
    m != undefined ? m.toString().padStart(2, '0') : '--',
  ]
  if (h != undefined) elems.unshift(h.toString().padStart(2, '0'));
  if (s != undefined) elems.push(s.toString().padStart(2, '0'));
  return elems.join(':')
}