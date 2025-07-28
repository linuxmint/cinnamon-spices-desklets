const locale = new Intl.NumberFormat().resolvedOptions().locale;

var capitalise = s => {
  return [s.slice(0, 1).toUpperCase(), s.slice(1)].join('');
};

var formatTime = (date, format24) => timeString({ h: date ? date.getHours() : null, m: date ? date.getMinutes() : null, format24 });

var roundTime = (startDate) => {
  const endDate = new Date();
  const diffMs = Math.abs(endDate - startDate); // Get difference in milliseconds
  const totalSeconds = Math.floor(diffMs / 1000);

  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${endDate < startDate ? '-' : '+'}${hours}:${minutes}:${seconds}`;
}

const timeString = ({ h, m, s, format24 }) => {

  const d = new Date();
  const millis = (h * 3600 + (m + d.getTimezoneOffset()) * 60 + (s || 0)) * 1000;
  return new Date(millis).toLocaleTimeString(locale, {
    hour12: !format24,
    timeStyle: 'short',
  }).replace(/\s/g, '');

}