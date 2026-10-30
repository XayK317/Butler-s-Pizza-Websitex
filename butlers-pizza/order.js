(function () {
  const CART_KEY = 'butlersPizzaCartV1';
  const WHEN_KEY = 'butlersPizzaWhenV1';
  const ORDERS_KEY = 'butlersPizzaOrdersV1';
  const OPEN_MIN = 11 * 60;
  const CLOSE_MIN = 20 * 60;
  const LUNCH_END_MIN = 14 * 60;
  const LEAD_MIN = 30;
  const DAYS_AHEAD = 7;
  const EMAIL = '3dbutlerpizza@att.net';

  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + n.toFixed(2);
  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
  };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  let categories = [];
  let coupons = [];
  let activeTab = '';
  let cart = load(CART_KEY, []);
  let when = load(WHEN_KEY, null);

  const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
  const isOpenNow = () => {
    const m = minutesOf(new Date());
    return m >= OPEN_MIN && m + LEAD_MIN <= CLOSE_MIN;
  };

  function pickupDate() {
    if (!when) return null;
    if (when.mode === 'now') return new Date(Date.now() + 25 * 60000);
    const d = new Date(when.iso);
    return isNaN(d) ? null : d;
  }

  function whenLabel() {
    if (!when) return 'Not chosen yet';
    if (when.mode === 'now') return 'ASAP · ready in about 20–30 minutes';
    const d = pickupDate();
    if (!d) return 'Not chosen yet';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) + ' at ' +
      d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function lunchAvailable() {
    const d = pickupDate();
    if (!d) return false;
    const m = minutesOf(d);
    return m >= OPEN_MIN && m < LUNCH_END_MIN;
  }

  function parsePrices(text) {
    return (text.match(/\$\s*\d+(?:\.\d{1,2})?/g) || []).map((p) => parseFloat(p.replace(/[$\s]/g, '')));
  }

  function readItems(root, selector) {
    return Array.from(root.querySelectorAll(selector)).map((el) => {
      const name = (el.querySelector('h3')?.textContent || '').trim();
      const desc = (el.querySelector('p')?.textContent || '').trim();
      const prices = parsePrices(el.querySelector('.item-price')?.textContent || '');
      return { name, desc, prices };
    }).filter((i) => i.name && i.prices.length);
  }

  function loadFrame(url) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      const timer = setTimeout(() => { frame.remove(); reject(new Error('timeout')); }, 10000);
      frame.onload = () => {
        // Give admin-content.js a tick to apply saved price edits.
        setTimeout(() => {
          clearTimeout(timer);
          const doc = frame.contentDocument;
          const result = doc ? { doc, frame } : null;
          result ? resolve(result) : reject(new Error('no document'));
        }, 150);
      };
      frame.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
      frame.src = url;
      document.body.appendChild(frame);
    });
  }

  async function loadMenu() {
    const status = $('menu-status');
    try {
      const menu = await loadFrame('menu.html');
      categories = Array.from(menu.doc.querySelectorAll('.menu-category')).map((section) => ({
        id: section.id,
        title: (section.querySelector('h2')?.textContent || section.id).trim(),
        lunch: section.id === 'lunch-specials',
        items: readItems(section, '.menu-category-items .menu-item')
      })).filter((c) => c.items.length);
      menu.frame.remove();

      try {
        const sp = await loadFrame('specials.html');
        const lunchItems = readItems(sp.doc, '.menu-columns div.menu-item');
        const existing = categories.find((c) => c.lunch);
        if (existing) {
          lunchItems.forEach((i) => {
            if (!existing.items.some((e) => e.name.toLowerCase() === i.name.toLowerCase())) existing.items.push(i);
          });
        } else if (lunchItems.length) {
          categories.unshift({ id: 'lunch-specials', title: 'Lunch Specials', lunch: true, items: lunchItems });
        }
        const couponSection = sp.doc.getElementById('coupon-heading')?.parentElement || sp.doc;
        coupons = Array.from(couponSection.querySelectorAll('article.menu-item h3'))
          .map((h) => h.textContent.trim()).filter(Boolean);
        sp.frame.remove();
      } catch (e) { /* specials are optional */ }

      categories.sort((a, b) => (b.lunch ? 1 : 0) - (a.lunch ? 1 : 0));
      if (!categories.length) throw new Error('empty');
      status.hidden = true;
      activeTab = categories[0].id;
      const select = $('coupon-select');
      coupons.forEach((c) => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c; select.appendChild(o);
      });
      renderMenu();
    } catch (e) {
      status.textContent = "We couldn't load the menu right now. Please call 317-600-5463 to order.";
    }
  }

  function renderMenu() {
    const tabs = $('order-tabs');
    tabs.textContent = '';
    categories.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(c.id === activeTab));
      b.textContent = c.title;
      b.addEventListener('click', () => { activeTab = c.id; renderMenu(); });
      tabs.appendChild(b);
    });

    const list = $('menu-list');
    list.textContent = '';
    const cat = categories.find((c) => c.id === activeTab);
    if (!cat) return;
    const lunchOk = lunchAvailable();
    cat.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'order-item';
      const text = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = item.name;
      if (cat.lunch) {
        const tag = document.createElement('span');
        tag.className = 'lunch-tag';
        tag.textContent = 'LUNCH ONLY';
        h.appendChild(tag);
      }
      text.appendChild(h);
      if (item.desc) {
        const p = document.createElement('p');
        p.textContent = item.desc;
        text.appendChild(p);
      }
      const side = document.createElement('div');
      side.className = 'item-side';
      item.prices.forEach((price, idx) => {
        const label = document.createElement('span');
        label.className = 'item-price';
        label.textContent = money(price);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.prices.length > 1 ? 'Add ' + (idx === 0 ? 'small' : idx === 1 ? 'large' : '#' + (idx + 1)) : 'Add';
        btn.addEventListener('click', () => addToCart(item, price, cat.lunch, item.prices.length > 1 ? btn.textContent.slice(4) : ''));
        side.append(label, btn);
      });
      row.append(text, side);
      list.appendChild(row);
    });
    if (cat.lunch) {
      const note = document.createElement('p');
      note.className = 'cart-note';
      note.textContent = lunchOk
        ? 'Lunch specials are available for pickups between 11am and 2pm.'
        : 'Lunch specials are only available for pickups between 11am and 2pm. Choose a pickup time in that window to include them.';
      list.prepend(note);
    }
  }

  function addToCart(item, price, lunch, size) {
    const key = item.name + '|' + price + '|' + size;
    const found = cart.find((l) => l.key === key);
    if (found) found.qty += 1;
    else cart.push({ key, name: item.name + (size ? ' (' + size + ')' : ''), price, qty: 1, lunch: !!lunch, note: '' });
    persistCart();
  }

  function persistCart() {
    save(CART_KEY, cart);
    renderCart();
  }

  function renderCart() {
    const lines = $('cart-lines');
    lines.textContent = '';
    const lunchOk = lunchAvailable();
    let total = 0;
    let blocked = false;
    cart.forEach((line, idx) => {
      total += line.price * line.qty;
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'line-name';
      name.textContent = line.name;
      const price = document.createElement('span');
      price.className = 'line-price';
      price.textContent = money(line.price * line.qty);
      const controls = document.createElement('span');
      controls.className = 'line-controls';
      const mk = (txt, label, fn, cls) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = txt; b.setAttribute('aria-label', label);
        if (cls) b.className = cls;
        b.addEventListener('click', fn);
        return b;
      };
      const qty = document.createElement('span');
      qty.textContent = String(line.qty);
      controls.append(
        mk('−', 'Decrease quantity of ' + line.name, () => { line.qty -= 1; if (line.qty < 1) cart.splice(idx, 1); persistCart(); }),
        qty,
        mk('+', 'Increase quantity of ' + line.name, () => { line.qty += 1; persistCart(); }),
        mk('Remove', 'Remove ' + line.name, () => { cart.splice(idx, 1); persistCart(); }, 'line-remove')
      );
      li.append(name, price, controls);
      const note = document.createElement('input');
      note.className = 'line-note';
      note.type = 'text';
      note.maxLength = 120;
      note.placeholder = 'Notes (toppings, no onions…)';
      note.value = line.note || '';
      note.setAttribute('aria-label', 'Notes for ' + line.name);
      note.addEventListener('input', () => { line.note = note.value; save(CART_KEY, cart); });
      li.appendChild(note);
      if (line.lunch && when && !lunchOk) {
        blocked = true;
        const warn = document.createElement('span');
        warn.className = 'line-warn';
        warn.textContent = 'Lunch special: pickup must be between 11am and 2pm.';
        li.appendChild(warn);
      }
      lines.appendChild(li);
    });
    $('cart-empty').hidden = cart.length > 0;
    $('cart-total').hidden = !cart.length;
    $('cart-note').hidden = !cart.length;
    $('cart-subtotal').textContent = money(total);
    const startBtn = $('start-checkout');
    startBtn.hidden = !cart.length || !$('checkout-form').hidden;
    startBtn.disabled = blocked;
    startBtn.title = blocked ? 'Change your pickup time or remove the lunch specials' : '';
    if (!cart.length) $('checkout-form').hidden = true;
    $('when-summary').textContent = whenLabel();
    $('change-when').textContent = when ? 'Change pickup time' : 'Choose pickup time';
  }

  /* Pickup time dialog */
  const dialog = $('when-dialog');
  function buildSlots() {
    const dateSel = $('when-date');
    const timeSel = $('when-time');
    const now = new Date();
    const earliest = new Date(now.getTime() + LEAD_MIN * 60000);
    const prevDate = dateSel.value;
    dateSel.textContent = '';
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const lastSlot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, CLOSE_MIN);
      if (lastSlot < earliest) continue;
      const o = document.createElement('option');
      o.value = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      o.textContent = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      o.dataset.ts = d.getTime();
      dateSel.appendChild(o);
    }
    if (prevDate && Array.from(dateSel.options).some((o) => o.value === prevDate)) dateSel.value = prevDate;
    fillTimes();
  }

  function fillTimes() {
    const dateSel = $('when-date');
    const timeSel = $('when-time');
    timeSel.textContent = '';
    const opt = dateSel.selectedOptions[0];
    if (!opt) return;
    const base = new Date(Number(opt.dataset.ts));
    const earliest = Date.now() + LEAD_MIN * 60000;
    for (let m = OPEN_MIN; m <= CLOSE_MIN; m += 15) {
      const slot = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, m);
      if (slot.getTime() < earliest) continue;
      const o = document.createElement('option');
      o.value = slot.toISOString();
      o.textContent = slot.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (m < LUNCH_END_MIN ? ' · lunch specials' : '');
      timeSel.appendChild(o);
    }
  }

  function openWhenDialog() {
    const nowRadio = dialog.querySelector('input[value="now"]');
    const laterRadio = dialog.querySelector('input[value="later"]');
    const open = isOpenNow();
    nowRadio.disabled = !open;
    nowRadio.closest('.when-option').classList.toggle('is-disabled', !open);
    $('now-hint').textContent = open ? 'Ready in about 20–30 minutes' : "We're closed or closing soon — please schedule for later";
    buildSlots();
    const pick = when && when.mode === 'later' ? 'later' : (open && when ? 'now' : (open ? '' : 'later'));
    nowRadio.checked = pick === 'now';
    laterRadio.checked = pick === 'later';
    $('when-later').hidden = pick !== 'later';
    $('when-error').hidden = true;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'when') $('when-later').hidden = e.target.value !== 'later';
  });
  $('when-date').addEventListener('change', fillTimes);
  $('when-cancel').addEventListener('click', () => dialog.close());
  $('when-form').addEventListener('submit', (e) => {
    const choice = dialog.querySelector('input[name="when"]:checked');
    const err = $('when-error');
    if (!choice) { e.preventDefault(); err.textContent = 'Please choose now or later.'; err.hidden = false; return; }
    if (choice.value === 'now') {
      if (!isOpenNow()) { e.preventDefault(); err.textContent = "We're not taking immediate orders right now. Please schedule for later."; err.hidden = false; return; }
      when = { mode: 'now' };
    } else {
      const iso = $('when-time').value;
      if (!iso) { e.preventDefault(); err.textContent = 'No pickup times are left for that day. Try another day.'; err.hidden = false; return; }
      when = { mode: 'later', iso };
    }
    save(WHEN_KEY, when);
    renderCart();
    renderMenu();
  });
  $('change-when').addEventListener('click', openWhenDialog);

  /* Checkout */
  $('start-checkout').addEventListener('click', () => {
    if (!when) { openWhenDialog(); return; }
    $('checkout-form').hidden = false;
    $('start-checkout').hidden = true;
    $('checkout-form').querySelector('input').focus();
  });

  function stale() {
    if (!when) return 'Please choose a pickup time first.';
    if (when.mode === 'now' && !isOpenNow()) return "We're no longer taking immediate orders. Please schedule a pickup time.";
    if (when.mode === 'later') {
      const d = pickupDate();
      if (!d || d.getTime() < Date.now() + 10 * 60000) return 'That pickup time has passed. Please choose a new one.';
    }
    if (cart.some((l) => l.lunch) && !lunchAvailable()) return 'Lunch specials need a pickup between 11am and 2pm.';
    return '';
  }

  $('checkout-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('form-error');
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    const name = f.name.value.trim();
    const phone = f.phone.value.trim();
    const email = f.email.value.trim();
    if (!cart.length) return fail('Your cart is empty.');
    if (!name) return fail('Please enter your name.');
    if (phone.replace(/\D/g, '').length < 10) return fail('Please enter a valid phone number.');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return fail('Please enter a valid email or leave it blank.');
    const problem = stale();
    if (problem) { fail(problem); openWhenDialog(); return; }
    err.hidden = true;

    const pickup = pickupDate();
    const orders = load(ORDERS_KEY, []);
    const number = 'BP-' + String(orders.length + 1).padStart(4, '0');
    const order = {
      number, name, phone, email,
      coupon: f.coupon.value, notes: f.notes.value.trim(),
      pickup: pickup.toISOString(), asap: when.mode === 'now',
      lines: cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price, note: l.note })),
      subtotal: cart.reduce((s, l) => s + l.price * l.qty, 0),
      placedAt: new Date().toISOString()
    };
    orders.push(order);
    save(ORDERS_KEY, orders);
    showConfirmation(order);
    cart = [];
    save(CART_KEY, cart);
    f.reset();
    f.hidden = true;
  });

  function orderText(o) {
    const lines = o.lines.map((l) => l.qty + ' x ' + l.name + ' - ' + money(l.price * l.qty) + (l.note ? ' (' + l.note + ')' : ''));
    return [
      'Order ' + o.number,
      'Name: ' + o.name, 'Phone: ' + o.phone, o.email ? 'Email: ' + o.email : '',
      'Pickup: ' + (o.asap ? 'ASAP (about 20-30 minutes)' : whenText(o)),
      '', ...lines, '', 'Subtotal: ' + money(o.subtotal),
      o.coupon ? 'Coupon/deal: ' + o.coupon : '', o.notes ? 'Notes: ' + o.notes : ''
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  }

  function whenText(o) {
    const d = new Date(o.pickup);
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) + ' at ' +
      d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function showConfirmation(o) {
    $('confirm-name').textContent = o.name;
    $('confirm-number').textContent = o.number;
    $('confirm-when').textContent = o.asap ? 'ASAP (about 20–30 minutes)' : whenText(o);
    $('confirm-total').textContent = money(o.subtotal);
    const ul = $('confirm-lines');
    ul.textContent = '';
    o.lines.forEach((l) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'line-name';
      n.textContent = l.qty + ' × ' + l.name + (l.note ? ' — ' + l.note : '');
      const p = document.createElement('span');
      p.className = 'line-price';
      p.textContent = money(l.price * l.qty);
      li.append(n, p);
      ul.appendChild(li);
    });
    $('confirm-email').href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('Pickup order ' + o.number) +
      '&body=' + encodeURIComponent(orderText(o));
    document.querySelector('.order-layout').hidden = true;
    document.querySelector('.when-bar').hidden = true;
    const c = $('order-confirm');
    c.hidden = false;
    c.focus();
    c.scrollIntoView({ block: 'start' });
  }

  $('new-order').addEventListener('click', () => {
    $('order-confirm').hidden = true;
    document.querySelector('.order-layout').hidden = false;
    document.querySelector('.when-bar').hidden = false;
    renderCart();
  });

  if (when && when.mode === 'later' && (!pickupDate() || pickupDate().getTime() < Date.now())) when = null;
  if (when && when.mode === 'now' && !isOpenNow()) when = null;
  renderCart();
  loadMenu();
})();
