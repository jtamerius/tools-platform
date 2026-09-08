/** UTC ISO -> a Date shifted into Mountain wall-clock, for Plotly axes. */
export const toMT = (utcStr) =>
  new Date(utcStr).toLocaleString('sv', { timeZone: 'America/Denver' }).replace(' ', 'T')
