import { api, cardHtml, remember, $, markReady, genreName, money, esc } from './common.js';

const data = await api('/games/home');
const featuredGame = data.featured[0];

const heroHtml = `
  <div class="hero-bg cinematic-bg" id="heroBg">
    <div class="layer layer-1" style="background-image: url('${esc(featuredGame.cover)}')"></div>
    <div class="layer layer-2"></div>
  </div>
  <div class="hero-content cinematic-content">
    <div class="hero-cover"><img src="${esc(featuredGame.cover)}" alt=""></div>
    <div class="hero-info">
      <div class="tag">${esc(genreName(featuredGame.genre))}</div>
      <h1 class="kinetic-text">${esc(featuredGame.title)}</h1>
      <p class="hero-desc">Experience the ultimate gameplay and discover new worlds in this premium masterpiece.</p>
      <div class="hero-price">
        ${featuredGame.discountPercent ? `<span class="old">${money(featuredGame.listPrice)}</span>` : ''}
        <strong>${money(featuredGame.unitPrice)}</strong>
      </div>
      <div class="hero-actions">
        <a class="btn primary big" href="/game/${esc(featuredGame.slug)}">BUY NOW</a>
        <a class="btn big" href="/game/${esc(featuredGame.slug)}">VIEW DETAILS</a>
      </div>
    </div>
  </div>
`;
$('#hero').innerHTML = heroHtml;
$('#hero').className = 'hero cinematic-hero';

for (const key of ['featured', 'bestsellers', 'newest', 'onSale']) {
  let items = data[key];
  if (key === 'featured') items = items.slice(1); // skip the hero one
  remember(items);
  $('#' + key).innerHTML = items.map(cardHtml).join('');
}
markReady();

// Scrolltelling Observer
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.remove('scroll-hide');
      setTimeout(() => e.target.style.transitionDelay = '', 600);
      observer.unobserve(e.target);
    }
  });
}, { rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.card').forEach((el, i) => {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('scroll-hide');
    el.style.transitionDelay = `${(i % 4) * 0.1}s`;
    observer.observe(el);
  }
});

// Cinematic Parallax
const heroBg = $('#heroBg');
const mql = window.matchMedia('(prefers-reduced-motion: reduce)');

if (!mql.matches && heroBg) {
  document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    heroBg.style.transform = `translate(${x * -6}px, ${y * -6}px)`;
    const cover = $('.hero-cover img');
    if (cover) cover.style.transform = `perspective(1000px) rotateX(${-y * 2}deg) rotateY(${x * 2}deg) scale(1.03) translate(${x * 3}px, ${y * 3}px)`;
  });
}
