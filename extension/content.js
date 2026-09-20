function first(...values) { return values.find(v => v && String(v).trim()) || ''; }
function meta(...keys) {
  for (const key of keys) {
    const el = document.querySelector(`meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`);
    if (el?.content) return el.content.trim();
  }
  return '';
}
function jsonProducts() {
  const found = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    try {
      const walk = obj => {
        if (!obj || typeof obj !== 'object') return;
        if (String(obj['@type']).toLowerCase().includes('product')) found.push(obj);
        Object.values(obj).forEach(v => Array.isArray(v) ? v.forEach(walk) : walk(v));
      }; walk(JSON.parse(el.textContent));
    } catch (_) {}
  });
  return found[0] || {};
}
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
    // Amazon presents the same product through many URLs. ASIN is its stable
    // product identity, so use it before comparing a URL with a saved row.
    if (/(^|\.)amazon\./i.test(u.hostname) && asin) return `${u.hostname.toLowerCase()}/dp/${asin.toUpperCase()}`;
    [...u.searchParams.keys()].filter(isTrackingParameter).forEach(k => u.searchParams.delete(k));
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '').toLowerCase();
    return `${host}${path}${u.search}`;
  } catch (_) { return raw; }
}
function isTrackingParameter(key) {
  const k = key.toLowerCase();
  return /^utm_/.test(k) || /^mc_/.test(k) || ['ref', 'tag', 'affiliate', 'src', 'source', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'fbclid', '_gl', '_ga', '_gac', '_gs', '_up'].includes(k);
}
function amazonProductData() {
  if (!/(^|\.)amazon\./i.test(location.hostname)) return {};
  const title = document.querySelector('#productTitle')?.textContent?.trim() || '';
  // Prefer the price in Amazon's product-price container. A product page can
  // contain many unrelated prices (recommendations, coupons, subscriptions).
  const priceBox = document.querySelector('#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price), #corePrice_feature_div .a-price:not(.a-text-price), #apex_desktop .a-price:not(.a-text-price), #priceblock_ourprice');
  const whole = priceBox?.querySelector('.a-price-whole')?.textContent?.replace(/[^0-9]/g, '') || '';
  const fraction = priceBox?.querySelector('.a-price-fraction')?.textContent?.replace(/[^0-9]/g, '') || '';
  // Keep the result numeric and preserve a $12 whole price as 12, not 12.00.
  const price = whole ? `${whole}${fraction ? `.${fraction.padStart(2, '0').slice(0, 2)}` : ''}` : '';
  return { title, price };
}
function extract() {
  const product = jsonProducts(); const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
  const amazon = amazonProductData();
  const canonical = first(document.querySelector('link[rel="canonical"]')?.href, location.href);
  const asin = first(new URL(location.href).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1], meta('sku', 'productID'), product.sku, product.mpn);
  const price = first(amazon.price, offer.price, meta('product:price:amount', 'price'), document.querySelector('[itemprop="price"]')?.content, document.querySelector('[itemprop="price"]')?.textContent);
  return { title: first(amazon.title, product.name, meta('og:title', 'twitter:title'), document.querySelector('h1')?.innerText, document.title), price: String(price).replace(/[^0-9.,-]/g, ''), url: location.href, canonicalUrl: canonical, normalizedUrl: normalizeUrl(canonical), vendor: location.hostname.replace(/^www\./, ''), image: first(product.image?.url, Array.isArray(product.image) ? product.image[0] : product.image, meta('og:image', 'twitter:image')), productId: asin, description: first(product.description, meta('description', 'og:description')), ambiguousPrice: !amazon.price && !offer.price && !meta('product:price:amount') };
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => { if (message.type === 'extract-page') reply(extract()); });
