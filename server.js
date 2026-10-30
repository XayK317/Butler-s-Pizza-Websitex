const fs = require('fs');
const path = require('path');
const express = require('express');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const SITE_DIR = path.join(__dirname, 'butlers-pizza');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.jsonl');
const PORT = process.env.PORT || 8080;
const TAX_RATE = parseFloat(process.env.TAX_RATE || '0.07');
const ORDER_EMAIL = process.env.ORDER_EMAIL || '3dbutlerpizza@att.net';
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

const pending = new Map();
const emailed = new Set();
let counter = fs.existsSync(ORDERS_FILE) ? fs.readFileSync(ORDERS_FILE, 'utf8').split('\n').filter(Boolean).length : 0;

const cents = (n) => Math.round(n * 100);
const money = (c) => '$' + (c / 100).toFixed(2);

function parsePrices(text) {
  return (text.match(/\$\s*\d+(?:\.\d{1,2})?/g) || []).map((p) => cents(parseFloat(p.replace(/[$\s]/g, ''))));
}

function loadMenuPrices() {
  const map = new Map();
  const read = (file, selector) => {
    const $ = cheerio.load(fs.readFileSync(path.join(SITE_DIR, file), 'utf8'));
    $(selector).each((_, el) => {
      const name = $(el).find('h3').first().text().trim().toLowerCase();
      const prices = parsePrices($(el).find('.item-price').first().text());
      if (name && prices.length) map.set(name, [...(map.get(name) || []), ...prices]);
    });
  };
  read('menu.html', '.menu-category .menu-category-items .menu-item');
  read('specials.html', '.menu-columns div.menu-item');
  return map;
}

function buildOrder(body) {
  const fail = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  const name = String(body.name || '').trim().slice(0, 60);
  const phone = String(body.phone || '').trim().slice(0, 20);
  const email = String(body.email || '').trim().slice(0, 80);
  if (!name) fail('Please enter your name.');
  if (phone.replace(/\D/g, '').length < 10) fail('Please enter a valid phone number.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail('Please enter a valid email.');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 60) fail('Your cart is empty.');
  const pickup = new Date(body.pickup);
  if (isNaN(pickup)) fail('Please choose a pickup time.');

  const menu = loadMenuPrices();
  const lines = body.lines.map((l) => {
    const qty = parseInt(l.qty, 10);
    const price = cents(Number(l.price));
    const base = String(l.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    if (!(qty >= 1 && qty <= 50)) fail('Invalid quantity.');
    if (!(menu.get(base) || []).includes(price)) fail('The menu changed. Please refresh and re-add "' + l.name + '".');
    return { name: String(l.name).slice(0, 100), qty, price, note: String(l.note || '').slice(0, 200) };
  });
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  return {
    name, phone, email,
    coupon: String(body.coupon || '').slice(0, 100),
    notes: String(body.notes || '').slice(0, 300),
    pickup: pickup.toISOString(),
    asap: !!body.asap,
    payment: body.payment === 'card' ? 'card' : 'counter',
    lines, subtotal, tax, total: subtotal + tax
  };
}

function orderText(o) {
  return [
    `Order ${o.number} - ${o.payment === 'card' ? 'PAID ONLINE' : 'PAY AT COUNTER'}`,
    `Name: ${o.name}`, `Phone: ${o.phone}`, o.email ? `Email: ${o.email}` : '',
    `Pickup: ${o.asap ? 'ASAP (20-30 min)' : new Date(o.pickup).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}`,
    '',
    ...o.lines.map((l) => `${l.qty} x ${l.name} - ${money(l.price * l.qty)}${l.note ? ` (${l.note})` : ''}`),
    '', `Subtotal: ${money(o.subtotal)}`, `Tax: ${money(o.tax)}`, `Total: ${money(o.total)}`,
    o.coupon ? `Coupon/deal: ${o.coupon}` : '', o.notes ? `Notes: ${o.notes}` : ''
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}

const toClient = (o) => ({
  ...o,
  lines: o.lines.map((l) => ({ ...l, price: l.price / 100 })),
  subtotal: o.subtotal / 100, tax: o.tax / 100, total: o.total / 100
});

async function sendOrderEmail(o) {
  if (emailed.has(o.number)) return;
  emailed.add(o.number);
  fs.appendFileSync(ORDERS_FILE, JSON.stringify(o) + '\n');
  if (!mailer) { console.log('[order - email not configured]\n' + orderText(o)); return; }
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ORDER_EMAIL,
      replyTo: o.email || undefined,
      subject: `New order ${o.number} - ${o.name}`,
      text: orderText(o)
    });
  } catch (e) { console.error('Order email failed:', e.message); }
}

const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));

const PARTIALS_DIR = path.join(__dirname, 'partials');
const NAV_PAGES = ['menu', 'specials', 'about', 'catering', 'faq', 'order'];

function renderPage(file) {
  const page = path.basename(file, '.html');
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('<!--include:')) return html;
  const partial = (name) => fs.readFileSync(path.join(PARTIALS_DIR, name + '.html'), 'utf8').trimEnd();
  let header = partial('header');
  if (NAV_PAGES.includes(page)) {
    header = header.replace(new RegExp(`(<a href="${page}\\.html")`), '$1 aria-current="page"');
  }
  return html.replace('<!--include:header-->', () => header).replace('<!--include:footer-->', () => partial('footer'));
}

app.get(/^\/(?:([\w-]+)\.html)?$/, (req, res, next) => {
  const file = path.join(SITE_DIR, (req.params[0] || 'index') + '.html');
  if (!fs.existsSync(file)) return next();
  res.type('html').send(renderPage(file));
});

app.get('/api/config', (req, res) => res.json({ api: true, cardEnabled: !!stripe, taxRate: TAX_RATE }));

app.post('/api/order', rateLimit, async (req, res) => {
  try {
    const order = buildOrder(req.body);
    order.number = 'BP-' + String(++counter).padStart(4, '0');
    order.placedAt = new Date().toISOString();

    if (order.payment === 'card') {
      if (!stripe) return res.status(400).json({ error: 'Online card payment is not available yet. Please pay at the counter.' });
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: order.email || undefined,
        line_items: [
          ...order.lines.map((l) => ({
            quantity: l.qty,
            price_data: { currency: 'usd', unit_amount: l.price, product_data: { name: l.name } }
          })),
          ...(order.tax ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: order.tax, product_data: { name: 'Sales tax' } } }] : [])
        ],
        metadata: { order: order.number, name: order.name, phone: order.phone },
        success_url: `${origin}/order.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/order.html`
      });
      pending.set(session.id, order);
      return res.json({ url: session.url });
    }

    await sendOrderEmail(order);
    res.json({ order: toClient(order) });
  } catch (e) {
    console.error(e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not place the order. Please call us.' });
  }
});

app.get('/api/order-status', async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Payments are not set up.' });
    const session = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
    if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not completed.' });
    const order = pending.get(session.id) || {
      number: session.metadata.order, name: session.metadata.name, phone: session.metadata.phone,
      payment: 'card', asap: true, pickup: new Date().toISOString(), lines: [],
      subtotal: session.amount_subtotal, tax: session.amount_total - session.amount_subtotal, total: session.amount_total
    };
    await sendOrderEmail(order);
    res.json({ order: toClient(order) });
  } catch (e) {
    console.error(e.message);
    res.status(400).json({ error: 'Could not verify payment.' });
  }
});

app.use(express.static(SITE_DIR, { extensions: ['html'] }));
app.listen(PORT, () => console.log(`Butler's Pizza running at http://localhost:${PORT}`));
