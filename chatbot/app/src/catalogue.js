/*
 * Live product search against the Shopify store.
 *
 * The knowledge base carries a ~30 item sample so the demo works offline. The
 * real store has around 900 products in stock, and a bot that can only see 30
 * of them will tell customers to ring about things sitting on the shelf.
 *
 * Configure:
 *   SHOPIFY_STORE_DOMAIN=smpr2021.myshopify.com
 *   SHOPIFY_STOREFRONT_TOKEN=...        (Storefront API access token, read-only)
 *
 * The Storefront API is the right one here: it is public-by-design, read-only,
 * and exposes exactly what a shopper may see. Do not use an Admin token for
 * this — it can write, and this code path is driven by customer input.
 *
 * Unset either variable and the server searches the knowledge base sample
 * instead, which is what the offline demo does.
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const TIMEOUT_MS = Number(process.env.SHOPIFY_TIMEOUT_MS || 3000);
const CACHE_MS = Number(process.env.SHOPIFY_CACHE_MS || 120_000);

const cache = new Map();

function configured() {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_STOREFRONT_TOKEN);
}

const QUERY = `
  query Search($q: String!, $n: Int!) {
    products(first: $n, query: $q, sortKey: RELEVANCE) {
      edges {
        node {
          title
          handle
          productType
          availableForSale
          featuredImage { url(transform: { maxWidth: 160 }) }
          priceRange { minVariantPrice { amount } }
          variants(first: 1) { edges { node { id quantityAvailable } } }
        }
      }
    }
  }
`;

// Shopify's search is happier with plain terms than with a sentence.
function buildQuery(terms) {
  const cleaned = terms
    .filter(t => t.length >= 3)
    .slice(0, 6)
    .map(t => t.replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.join(' ') + ' AND available_for_sale:true';
}

function mapNode(node) {
  const variant = node.variants?.edges?.[0]?.node;
  const qty = variant?.quantityAvailable;
  return {
    t: node.title,
    h: node.handle,
    c: node.productType || '',
    p: Number(node.priceRange.minVariantPrice.amount),
    // quantityAvailable needs the unauthenticated_read_product_inventory scope;
    // without it Shopify returns null, so fall back to the in-stock flag.
    s: typeof qty === 'number' ? qty : (node.availableForSale ? 1 : 0),
    // numeric id only - the cart permalink does not take the gid:// form
    v: variant?.id ? String(variant.id).split('/').pop() : null,
    // full URL already; brain.js only prefixes imageBase onto relative paths
    img2: node.featuredImage?.url || null
  };
}

/**
 * Search the live store. Resolves to an array of catalogue items in the same
 * shape as the knowledge-base sample, or null if it cannot answer — the caller
 * then falls back to the sample rather than telling the customer nothing.
 */
async function search(terms, limit = 10) {
  if (!configured()) return null;

  const q = buildQuery(terms);
  if (!q) return null;

  const key = q + '|' + limit;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_TOKEN
        },
        body: JSON.stringify({ query: QUERY, variables: { q, n: limit } })
      }
    );
    if (!res.ok) throw new Error('Shopify returned ' + res.status);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));

    const items = (json.data?.products?.edges || []).map(e => mapNode(e.node));
    cache.set(key, { at: Date.now(), value: items });
    return items;
  } catch (err) {
    console.error('[shopify] product search failed (%s): %s', q, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { search, configured, buildQuery, mapNode };
