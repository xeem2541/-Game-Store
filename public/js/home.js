import { api, cardHtml, remember, $, markReady } from './common.js';

const data = await api('/games/home');
for (const key of ['featured', 'bestsellers', 'newest', 'onSale']) {
  remember(data[key]);
  $('#' + key).innerHTML = data[key].map(cardHtml).join('');
}
markReady();
