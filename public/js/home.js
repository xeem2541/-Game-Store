import { api, cardHtml, remember, $, markReady } from './common.js';

const data = await api('/games/home');
for (const key of ['featured', 'bestsellers', 'newest', 'onSale']) {
  remember(data[key]);
  $('#' + key).innerHTML = data[key].map(cardHtml).join('');
}
markReady();

// Parallax Hero
const heroBg = $('#heroBg');
if (heroBg) {
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!mql.matches) {
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y < window.innerHeight) {
        heroBg.style.transform = `translateY(${y * 0.4}px)`;
      }
    }, { passive: true });
  }
}
