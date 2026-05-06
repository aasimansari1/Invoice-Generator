/* =========================================================
 * Invoice Generator — main logic
 * Sections:
 *   1. Constants & State
 *   2. Utilities (formatting, DOM helpers, toast)
 *   3. Items management (add / remove / read)
 *   4. Live preview rendering
 *   5. Calculations (subtotal, tax, discount, grand total)
 *   6. Persistence (current draft + history)
 *   7. Actions (PDF, image, print, reset, save)
 *   8. History modal (search, load, delete)
 *   9. Theme toggle
 *  10. Init / event wiring
 * ======================================================= */

/* ---------- 1. Constants & State ---------- */
const STORAGE_KEYS = {
  draft: 'ig_current_invoice',
  history: 'ig_invoice_history',
  counter: 'ig_invoice_counter',
  theme: 'ig_theme'
};

// Single source of truth for the form state — re-read from DOM on each render.
let currencySymbol = '₹';

/* ---------- 2. Utilities ---------- */
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Format a number as currency using the chosen symbol. */
function formatCurrency(n) {
  const num = Number.isFinite(+n) ? +n : 0;
  // Indian-style thousands grouping when ₹ chosen, else en-US.
  const locale = currencySymbol === '₹' ? 'en-IN' : 'en-US';
  return currencySymbol + num.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Generate a sequential invoice number like INV-20260506-0001. */
function generateInvoiceNumber() {
  const counter = (+localStorage.getItem(STORAGE_KEYS.counter) || 0) + 1;
  localStorage.setItem(STORAGE_KEYS.counter, counter);
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `INV-${ymd}-${String(counter).padStart(4, '0')}`;
}

/** Pretty-format the current date+time for display. */
function formatDateTime(d = new Date()) {
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/** Show a transient toast at the bottom of the screen. */
let toastTimeout;
function showToast(message, type = '') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    t.className = 'toast hidden';
  }, 2400);
}

/** Escape HTML to prevent XSS when rendering user input into preview. */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/* ---------- 3. Items management ---------- */
/** Append a new empty item row to the form. */
function addItemRow(item = { name: '', qty: 1, price: 0 }) {
  const tbody = $('itemsBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="item-name" placeholder="Item or service" value="${esc(item.name)}" /></td>
    <td><input type="number" class="item-qty" min="1" step="1" value="${item.qty}" /></td>
    <td><input type="number" class="item-price" min="0" step="0.01" value="${item.price}" /></td>
    <td class="item-total">${formatCurrency((item.qty || 0) * (item.price || 0))}</td>
    <td><button type="button" class="btn-remove" title="Remove">×</button></td>
  `;
  tbody.appendChild(tr);

  // Wire input listeners — each change re-renders preview.
  qsa('input', tr).forEach((el) => el.addEventListener('input', renderAll));
  qs('.btn-remove', tr).addEventListener('click', () => {
    tr.remove();
    renderAll();
  });
}

/** Read all current items from the form rows. */
function readItems() {
  return qsa('#itemsBody tr').map((tr) => {
    const name = qs('.item-name', tr).value.trim();
    const qty = parseFloat(qs('.item-qty', tr).value) || 0;
    const price = parseFloat(qs('.item-price', tr).value) || 0;
    return { name, qty, price, total: qty * price };
  });
}

/* ---------- 4. Live preview rendering ---------- */
function renderPreview() {
  // Company info
  $('prevCompanyName').textContent = $('companyName').value.trim() || 'Your Company';
  $('prevCompanyAddress').textContent = $('companyAddress').value.trim() || '—';
  $('prevCompanyPhone').textContent = $('companyPhone').value.trim();

  const email = $('companyEmail').value.trim();
  $('prevCompanyEmail').textContent = email;
  $('prevCompanyEmailWrap').style.display = email ? '' : 'none';

  const gstin = $('companyGSTIN').value.trim();
  $('prevCompanyGSTIN').textContent = gstin;
  $('prevCompanyGSTINWrap').classList.toggle('hidden', !gstin);

  // Meta
  $('prevInvoiceNumber').textContent = $('invoiceNumber').value;
  $('prevInvoiceDate').textContent = $('invoiceDate').value;

  const status = $('paymentStatus').value;
  const badge = $('prevStatus');
  badge.textContent = status;
  badge.className = 'status-badge ' + status.toLowerCase();

  // Customer
  $('prevCustomerName').textContent = $('customerName').value.trim() || '—';
  $('prevCustomerAddress').textContent = $('customerAddress').value.trim() || '—';
  $('prevCustomerPhone').textContent = $('customerPhone').value.trim() || '—';

  // Items
  const items = readItems();
  const tbody = $('prevItemsBody');
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">No items added yet.</td></tr>`;
  } else {
    tbody.innerHTML = items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.name) || '<span class="muted">Unnamed item</span>'}</td>
        <td class="r">${it.qty}</td>
        <td class="r">${formatCurrency(it.price)}</td>
        <td class="r">${formatCurrency(it.total)}</td>
      </tr>
    `).join('');
  }

  // Update inline item totals in form too.
  qsa('#itemsBody tr').forEach((tr, i) => {
    qs('.item-total', tr).textContent = formatCurrency(items[i].total);
  });

  // Notes
  const notes = $('notes').value.trim();
  $('prevNotes').textContent = notes || '—';
}

/* ---------- 5. Calculations ---------- */
function calcTotals() {
  const items = readItems();
  const subtotal = items.reduce((s, it) => s + it.total, 0);

  const taxRate = Math.max(0, parseFloat($('taxRate').value) || 0);
  const taxAmount = (subtotal * taxRate) / 100;

  const discountValue = Math.max(0, parseFloat($('discountValue').value) || 0);
  const discountType = $('discountType').value;
  const discountAmount = discountType === 'percent'
    ? (subtotal * discountValue) / 100
    : discountValue;

  // Grand total cannot go below zero.
  const grandTotal = Math.max(0, subtotal + taxAmount - discountAmount);

  $('prevSubtotal').textContent = formatCurrency(subtotal);
  $('prevTaxRate').textContent = taxRate;
  $('prevTaxAmount').textContent = formatCurrency(taxAmount);
  $('prevDiscount').textContent = '−' + formatCurrency(discountAmount);
  $('prevGrandTotal').textContent = formatCurrency(grandTotal);

  return { subtotal, taxRate, taxAmount, discountValue, discountType, discountAmount, grandTotal };
}

/** Combined render: preview text + numeric totals + persist draft. */
function renderAll() {
  // Currency symbol may have changed — refresh.
  currencySymbol = $('currencySymbol').value;
  renderPreview();
  calcTotals();
  saveDraft();
}

/* ---------- 6. Persistence ---------- */
/** Build a serializable snapshot of the current invoice. */
function snapshot() {
  return {
    company: {
      name: $('companyName').value,
      email: $('companyEmail').value,
      phone: $('companyPhone').value,
      address: $('companyAddress').value,
      gstin: $('companyGSTIN').value
    },
    currencySymbol: $('currencySymbol').value,
    meta: {
      number: $('invoiceNumber').value,
      date: $('invoiceDate').value,
      status: $('paymentStatus').value
    },
    customer: {
      name: $('customerName').value,
      phone: $('customerPhone').value,
      address: $('customerAddress').value
    },
    items: readItems(),
    charges: {
      taxRate: $('taxRate').value,
      discountValue: $('discountValue').value,
      discountType: $('discountType').value
    },
    notes: $('notes').value,
    savedAt: new Date().toISOString()
  };
}

/** Apply a snapshot back into the form. */
function applySnapshot(s) {
  if (!s) return;
  $('companyName').value = s.company?.name || '';
  $('companyEmail').value = s.company?.email || '';
  $('companyPhone').value = s.company?.phone || '';
  $('companyAddress').value = s.company?.address || '';
  $('companyGSTIN').value = s.company?.gstin || '';
  $('currencySymbol').value = s.currencySymbol || '₹';

  $('invoiceNumber').value = s.meta?.number || generateInvoiceNumber();
  $('invoiceDate').value = s.meta?.date || formatDateTime();
  $('paymentStatus').value = s.meta?.status || 'Unpaid';

  $('customerName').value = s.customer?.name || '';
  $('customerPhone').value = s.customer?.phone || '';
  $('customerAddress').value = s.customer?.address || '';

  $('taxRate').value = s.charges?.taxRate ?? 5;
  $('discountValue').value = s.charges?.discountValue ?? 0;
  $('discountType').value = s.charges?.discountType || 'flat';
  $('notes').value = s.notes || '';

  // Rebuild items
  $('itemsBody').innerHTML = '';
  (s.items && s.items.length ? s.items : [{ name: '', qty: 1, price: 0 }])
    .forEach((it) => addItemRow(it));

  renderAll();
}

function saveDraft() {
  try {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(snapshot()));
  } catch (e) {
    // Storage may be full or disabled; non-fatal.
    console.warn('Draft save failed:', e);
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.history)) || [];
  } catch {
    return [];
  }
}

function setHistory(arr) {
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(arr));
}

/* ---------- 7. Validation ---------- */
function validateForCommit() {
  const errors = [];
  if (!$('customerName').value.trim()) errors.push('Customer name is required.');
  if (!$('customerPhone').value.trim()) errors.push('Customer phone is required.');
  if (!$('customerAddress').value.trim()) errors.push('Customer address is required.');

  const items = readItems();
  if (items.length === 0) errors.push('Add at least one item.');

  items.forEach((it, i) => {
    if (!it.name) errors.push(`Item ${i + 1}: name is required.`);
    if (it.qty <= 0) errors.push(`Item ${i + 1}: quantity must be positive.`);
    if (it.price < 0) errors.push(`Item ${i + 1}: price cannot be negative.`);
  });

  const tax = parseFloat($('taxRate').value);
  if (isNaN(tax) || tax < 0) errors.push('Tax rate must be 0 or greater.');

  return errors;
}

/* ---------- 8. Actions ---------- */
/** Save the current invoice to history (and start a fresh number for the next one). */
function saveInvoice() {
  const errors = validateForCommit();
  if (errors.length) {
    showToast(errors[0], 'error');
    return;
  }
  const snap = snapshot();
  const totals = calcTotals();
  snap.totals = totals;

  const history = getHistory();
  // If an entry with the same invoice number exists, replace it; else prepend.
  const idx = history.findIndex((h) => h.meta?.number === snap.meta.number);
  if (idx >= 0) history[idx] = snap;
  else history.unshift(snap);

  // Keep history bounded.
  if (history.length > 100) history.length = 100;
  setHistory(history);
  showToast('Invoice saved to history', 'success');
}

/** Download invoice preview as a PDF using html2canvas + jsPDF. */
async function downloadPDF() {
  const errors = validateForCommit();
  if (errors.length) {
    showToast(errors[0], 'error');
    return;
  }
  showToast('Generating PDF…');
  const node = $('invoicePreview');

  try {
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true
    });
    const imgData = canvas.toDataURL('image/png');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Fit image width to page; preserve aspect ratio. Multi-page if taller.
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    } else {
      // Slice the image across pages.
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    pdf.save(`${$('invoiceNumber').value || 'invoice'}.pdf`);
    showToast('PDF downloaded', 'success');
  } catch (e) {
    console.error(e);
    showToast('PDF generation failed', 'error');
  }
}

/** Export invoice preview as PNG image. */
async function downloadImage() {
  const errors = validateForCommit();
  if (errors.length) {
    showToast(errors[0], 'error');
    return;
  }
  showToast('Generating image…');
  try {
    const canvas = await html2canvas($('invoicePreview'), {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true
    });
    const link = document.createElement('a');
    link.download = `${$('invoiceNumber').value || 'invoice'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Image downloaded', 'success');
  } catch (e) {
    console.error(e);
    showToast('Image export failed', 'error');
  }
}

function printInvoice() {
  window.print();
}

function resetForm() {
  if (!confirm('Reset the form? Unsaved changes will be lost.')) return;
  localStorage.removeItem(STORAGE_KEYS.draft);

  // Clear fields
  ['companyName', 'companyEmail', 'companyPhone', 'companyAddress', 'companyGSTIN',
   'customerName', 'customerPhone', 'customerAddress', 'notes'].forEach((id) => $(id).value = '');

  $('currencySymbol').value = '₹';
  $('paymentStatus').value = 'Unpaid';
  $('taxRate').value = 5;
  $('discountValue').value = 0;
  $('discountType').value = 'flat';

  $('invoiceNumber').value = generateInvoiceNumber();
  $('invoiceDate').value = formatDateTime();

  $('itemsBody').innerHTML = '';
  addItemRow();

  renderAll();
  showToast('Form reset', 'success');
}

/* ---------- 9. History modal ---------- */
function openHistory() {
  renderHistoryList($('historySearch').value);
  $('historyModal').classList.remove('hidden');
}
function closeHistory() {
  $('historyModal').classList.add('hidden');
}

function renderHistoryList(filter = '') {
  const list = $('historyList');
  const items = getHistory();
  const f = filter.trim().toLowerCase();

  const filtered = !f ? items : items.filter((s) => {
    return [
      s.meta?.number, s.customer?.name, s.customer?.phone,
      s.meta?.status, s.company?.name
    ].some((v) => String(v || '').toLowerCase().includes(f));
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="history-empty">No invoices found.</div>`;
    return;
  }

  list.innerHTML = filtered.map((s, i) => {
    // We need original index for delete; locate it in items.
    const origIdx = items.indexOf(s);
    const total = s.totals?.grandTotal ?? 0;
    return `
      <div class="history-item" data-idx="${origIdx}">
        <div class="meta">
          <span class="num">${esc(s.meta?.number || '—')}</span>
          <span class="sub">
            ${esc(s.customer?.name || '—')} ·
            ${esc(s.meta?.status || '')} ·
            ${esc(s.currencySymbol || '₹')}${(+total).toFixed(2)}
          </span>
          <span class="sub">${esc(s.meta?.date || '')}</span>
        </div>
        <div class="actions-mini">
          <button class="btn btn-secondary" data-load="${origIdx}">Load</button>
          <button class="btn btn-danger" data-delete="${origIdx}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Wire load / delete buttons
  qsa('[data-load]', list).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = +b.dataset.load;
    const all = getHistory();
    applySnapshot(all[idx]);
    closeHistory();
    showToast('Invoice loaded', 'success');
  }));
  qsa('[data-delete]', list).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Delete this invoice from history?')) return;
    const idx = +b.dataset.delete;
    const all = getHistory();
    all.splice(idx, 1);
    setHistory(all);
    renderHistoryList($('historySearch').value);
    showToast('Invoice deleted', 'success');
  }));
}

/* ---------- 10. Theme ---------- */
function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  $('themeToggle').textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}
function toggleTheme() {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
}

/* ---------- 11. Init ---------- */
function init() {
  // Theme
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'light');
  $('themeToggle').addEventListener('click', toggleTheme);

  // Wire static inputs to re-render on change.
  qsa('input, select, textarea', $('companyName').closest('.form-panel'))
    .forEach((el) => {
      // item rows manage their own listeners; skip them.
      if (el.closest('#itemsBody')) return;
      el.addEventListener('input', renderAll);
      el.addEventListener('change', renderAll);
    });

  // Buttons
  $('addItemBtn').addEventListener('click', () => {
    addItemRow();
    renderAll();
  });
  $('saveBtn').addEventListener('click', saveInvoice);
  $('downloadPdfBtn').addEventListener('click', downloadPDF);
  $('downloadImgBtn').addEventListener('click', downloadImage);
  $('printBtn').addEventListener('click', printInvoice);
  $('resetBtn').addEventListener('click', resetForm);

  // History modal
  $('historyBtn').addEventListener('click', openHistory);
  qsa('[data-close]', $('historyModal')).forEach((el) =>
    el.addEventListener('click', closeHistory));
  $('historySearch').addEventListener('input', (e) =>
    renderHistoryList(e.target.value));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHistory();
  });

  // Load draft if any, else start a fresh invoice.
  const draft = loadDraft();
  if (draft) {
    applySnapshot(draft);
    showToast('Restored last invoice draft');
  } else {
    $('invoiceNumber').value = generateInvoiceNumber();
    $('invoiceDate').value = formatDateTime();
    addItemRow();
    renderAll();
  }
}

document.addEventListener('DOMContentLoaded', init);
