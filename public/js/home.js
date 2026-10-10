import { api, cardHtml, remember, $, markReady, genreName, money, esc, applyI18n } from './common.js';
import { initThreeHero } from './three-hero.js';
import { gsap, ScrollTrigger } from './vendor.bundle.js';

gsap.registerPlugin(ScrollTrigger);

const data = await api('/games/home');
const featuredGame = data.featured[0];

const heroHtml = `
  <div class="hero-bg" id="heroBg">
    <!-- 3D Canvas will be injected here -->
  </div>
  <div class="hero-content cinematic-content">
    <div class="hero-info">
      <div class="tag-group">
        <span class="tag">NEXUS EXCLUSIVE</span>
        <span class="tag outline">${esc(featuredGame ? genreName(featuredGame.genre) : 'NEW ARRIVALS')}</span>
      </div>
      <h1 class="kinetic-text">
        <span class="line-1" data-i18n="hero.title">เกมแท้ ราคาโดนใจ</span><br>
      </h1>
      <p class="hero-desc">Discover your next obsession. Explore worlds, unlock adventures, and find your next favorite game. ${featuredGame ? `Featured: <strong>${esc(featuredGame.title)}</strong>` : ''}</p>
      
      <div class="hero-actions">
        <a class="btn primary big" href="${featuredGame ? `/game/${esc(featuredGame.slug)}` : '/games.html'}">
          EXPLORE GAMES
        </a>
        <a class="btn big glass" href="/games.html?onSale=1">
          VIEW DEALS
        </a>
      </div>
      
      <div class="hero-stats">
        <div class="stat"><span class="val">2K+</span><span class="lbl">GAMES</span></div>
        <div class="stat"><span class="val">24/7</span><span class="lbl">SUPPORT</span></div>
        <div class="stat"><span class="val">INSTANT</span><span class="lbl">DELIVERY</span></div>
      </div>
    </div>
  </div>
`;
$('#hero').innerHTML = heroHtml;
$('#hero').className = 'hero futuristic-hero';
applyI18n($('#hero'));

// Initialize 3D Hero
initThreeHero('heroBg');

// GSAP Animations for Hero
const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!mql.matches) {
  const tl = gsap.timeline();
  tl.fromTo('.tag-group', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 0.2 })
    .fromTo('.kinetic-text span', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.2, ease: 'power3.out' }, '-=0.4')
    .fromTo('.hero-desc', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, '-=0.4')
    .fromTo('.hero-actions .btn', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out' }, '-=0.4')
    .fromTo('.hero-stats .stat', { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, stagger: 0.1, ease: 'back.out(1.5)' }, '-=0.2');
}

for (const key of ['featured', 'bestsellers', 'newest', 'onSale']) {
  let items = data[key];
  if (key === 'featured') items = items.slice(1); // skip the hero one
  remember(items);
  $('#' + key).innerHTML = items.map(cardHtml).join('');
}
markReady();

// GSAP Scroll Animations for Cards
if (!mql.matches) {
  document.querySelectorAll('.sec').forEach(sec => {
    gsap.fromTo(sec, 
      { opacity: 0, x: -30 },
      { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: sec, start: 'top 85%' } }
    );
  });

  document.querySelectorAll('.grid').forEach(grid => {
    const cards = grid.querySelectorAll('.card');
    gsap.fromTo(cards,
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 0.6, stagger: 0.05, ease: 'power2.out', scrollTrigger: { trigger: grid, start: 'top 85%' } }
    );
  });
}
