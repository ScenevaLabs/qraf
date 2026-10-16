// "Depo Etiketi" görsel kimliği — bkz. qRaf/DESIGN.md.
// Masaüstündeki gibi Bebas Neue/Special Elite/Courier Prime fontları
// bu ilk sürümde bundle edilmedi (ayrı bir görsel cila adımı olarak
// PLAN.md'de not edildi) — sistem fontlarıyla aynı kalın/mono karakter
// korunuyor.
export const colors = {
  kraft: '#D9CBA6',
  labelPaper: '#F3EEDF',
  ink: '#1C1A16',
  inkSoft: '#6B6455',
  stampRed: '#A3362A',
  perforation: '#B5A780',
};

export const fonts = {
  heading: { fontWeight: '700' as const, letterSpacing: 0.5 },
  mono: { fontFamily: 'monospace' as const },
};
