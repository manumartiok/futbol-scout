// Ligas disponibles (slug de ESPN). El orden define el orden en pantalla.
const FLAG = c => `https://a.espncdn.com/i/teamlogos/countries/500/${c}.png`;

module.exports = [
  { slug: 'eng.1', name: 'Premier League', country: 'Inglaterra', flag: FLAG('eng') },
  { slug: 'esp.1', name: 'LaLiga', country: 'España', flag: FLAG('esp') },
  { slug: 'ita.1', name: 'Serie A', country: 'Italia', flag: FLAG('ita') },
  { slug: 'ger.1', name: 'Bundesliga', country: 'Alemania', flag: FLAG('ger') },
  { slug: 'fra.1', name: 'Ligue 1', country: 'Francia', flag: FLAG('fra') },
  { slug: 'por.1', name: 'Liga Portugal', country: 'Portugal', flag: FLAG('por') },
  { slug: 'ned.1', name: 'Eredivisie', country: 'Países Bajos', flag: FLAG('ned') },
  { slug: 'bel.1', name: 'Pro League', country: 'Bélgica', flag: FLAG('bel') },
  { slug: 'tur.1', name: 'Süper Lig', country: 'Turquía', flag: FLAG('tur') },
  { slug: 'sco.1', name: 'Premiership', country: 'Escocia', flag: FLAG('sco') },
  { slug: 'eng.2', name: 'Championship', country: 'Inglaterra', flag: FLAG('eng') },
  { slug: 'arg.1', name: 'Liga Profesional', country: 'Argentina', flag: FLAG('arg') },
  { slug: 'bra.1', name: 'Brasileirão', country: 'Brasil', flag: FLAG('bra') },
  { slug: 'mex.1', name: 'Liga MX', country: 'México', flag: FLAG('mex') },
  { slug: 'usa.1', name: 'MLS', country: 'Estados Unidos', flag: FLAG('usa') },
  { slug: 'ksa.1', name: 'Saudi Pro League', country: 'Arabia Saudita', flag: FLAG('ksa') },
];
