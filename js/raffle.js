(() => {
  const RAFFLE_SLUG = 'patagonia-fc-tournament-fundraising-raffle';
  const API_URL = `/api/raffles/${RAFFLE_SLUG}`;
  const GIVEALITTLE_URL = 'https://givealittle.co.nz/cause/patagonia-fc-tournament-fundraiser-2026';
  const REFRESH_INTERVAL = 20000;
  const state = { raffle: null, selected: null, loading: false, submitting: false, reservationRequestId: '' };
  const grid = document.querySelector('[data-raffle-number-grid]');
  const liveStatus = document.querySelector('[data-raffle-live-status]');
  const form = document.querySelector('[data-raffle-checkout-form]');
  if (!grid || !form) return;

  const status = document.querySelector('[data-raffle-checkout-status]');
  const reserveButton = document.querySelector('[data-raffle-checkout]');
  const refreshButton = document.querySelector('[data-raffle-refresh]');
  const confirmation = document.querySelector('[data-raffle-confirmation]');
  let refreshTimer = 0;

  function money(cents) {
    return `NZ${new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(cents || 0) / 100)}`;
  }

  function setStatus(message, type = 'info') {
    status.textContent = message;
    status.className = `raffle-checkout-status is-${type}`;
    status.hidden = !message;
  }

  function renderSummary() {
    const selected = state.selected;
    const amount = selected ? Number(state.raffle?.ticketPriceCents || 2000) : 0;
    document.querySelector('[data-raffle-selected]').textContent = selected
      ? String(selected).padStart(2, '0')
      : 'None selected';
    document.querySelector('[data-raffle-ticket-count]').textContent = selected ? '1' : '0';
    document.querySelector('[data-raffle-total]').textContent = money(amount);
    reserveButton.disabled = !selected || state.submitting || Boolean(state.raffle?.soldOut);
  }

  function renderProgress() {
    const soldCount = Number(state.raffle?.soldCount || 0);
    const total = Number(state.raffle?.totalNumbers || 40);
    const percentage = total ? Math.round((soldCount / total) * 100) : 0;
    document.querySelector('[data-raffle-progress-label]').textContent = `${soldCount} of ${total} numbers sold`;
    document.querySelector('[data-raffle-progress-percent]').textContent = `${percentage}% sold`;
    const progress = document.querySelector('[data-raffle-progress]');
    progress.setAttribute('aria-valuemax', String(total));
    progress.setAttribute('aria-valuenow', String(soldCount));
    progress.querySelector('span').style.width = `${percentage}%`;
  }

  function numberButton(item) {
    const selected = state.selected === item.number && item.status === 'available';
    const numberStatus = selected ? 'selected' : item.status;
    const label = numberStatus === 'available' ? 'Available' : numberStatus === 'selected' ? 'Selected' : numberStatus === 'reserved' ? 'Reserved' : 'Sold';
    return `<button type="button" class="raffle-number is-${numberStatus}" data-raffle-number="${item.number}"
      aria-label="Drawing number ${String(item.number).padStart(2, '0')}, ${label}"
      aria-pressed="${selected ? 'true' : 'false'}" ${['reserved', 'sold'].includes(numberStatus) ? 'disabled aria-disabled="true"' : ''}>
      <strong>${String(item.number).padStart(2, '0')}</strong><span>${label}</span></button>`;
  }

  function renderNumbers() {
    grid.innerHTML = state.raffle.numbers.map(numberButton).join('');
    grid.setAttribute('aria-busy', 'false');
    renderProgress();
    renderSummary();
    document.querySelector('[data-raffle-sold-out]').hidden = !state.raffle.soldOut;
    if (state.raffle.soldOut) liveStatus.textContent = 'Prize drawing sold out. Thank you for supporting Patagonia FC.';
  }

  async function refreshAvailability({ announce = false } = {}) {
    if (state.loading) return false;
    state.loading = true;
    refreshButton.disabled = true;
    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.raffle) throw new Error(result.error || 'Availability could not be loaded.');
      state.raffle = result.raffle;
      const selectedState = result.raffle.numbers.find(item => item.number === state.selected)?.status;
      if (confirmation.hidden && state.selected && selectedState !== 'available') {
        state.selected = null;
        state.reservationRequestId = '';
        setStatus('That number is no longer available. Please choose another number.', 'error');
      }
      renderNumbers();
      if (announce) liveStatus.textContent = 'Drawing availability updated.';
      else if (!state.raffle.soldOut) liveStatus.textContent = 'Availability is current. Reserved numbers cannot be selected by anyone else.';
      return true;
    } catch (error) {
      liveStatus.textContent = 'Current drawing availability could not be loaded. Please try again.';
      if (!state.raffle) grid.innerHTML = '<p class="raffle-grid-error">Drawing numbers are temporarily unavailable.</p>';
      return false;
    } finally {
      state.loading = false;
      refreshButton.disabled = false;
    }
  }

  function customerDetails() {
    const customerName = String(form.elements.customerName.value || '').replace(/\s+/g, ' ').trim();
    const childName = String(form.elements.childName.value || '').replace(/\s+/g, ' ').trim();
    const customerEmail = String(form.elements.customerEmail.value || '').trim().toLowerCase();
    if (!customerName) return { error: 'Enter the Customer Name.', field: form.elements.customerName };
    if (!childName) return { error: "Enter the Child's Name.", field: form.elements.childName };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return { error: 'Enter a valid email address.', field: form.elements.customerEmail };
    return { customerName, childName, customerEmail };
  }

  function setSubmitting(submitting) {
    state.submitting = submitting;
    reserveButton.disabled = submitting || !state.selected || Boolean(state.raffle?.soldOut);
    reserveButton.textContent = submitting ? 'Reserving your number…' : 'Reserve Number';
    reserveButton.setAttribute('aria-busy', submitting ? 'true' : 'false');
  }

  function showConfirmation(reservation) {
    const number = String(reservation.number).padStart(2, '0');
    document.querySelector('[data-raffle-confirmed-number]').textContent = `#${number}`;
    document.querySelector('[data-raffle-donation-message]').textContent = reservation.donationMessage;
    document.querySelector('[data-raffle-confirmation-expiry]').textContent = `Reserved until ${new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${reservation.expiresAt.replace(' ', 'T')}Z`))}.`;
    const link = document.querySelector('[data-raffle-givealittle]');
    link.href = reservation.url || GIVEALITTLE_URL;
    confirmation.hidden = false;
    form.hidden = true;
    setStatus('Your number is reserved. Complete your donation on Givealittle.', 'success');
    confirmation.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-raffle-number]');
    if (!button || button.disabled || state.submitting || !confirmation.hidden) return;
    const number = Number(button.dataset.raffleNumber);
    state.selected = state.selected === number ? null : number;
    state.reservationRequestId = '';
    setStatus('');
    renderNumbers();
    liveStatus.textContent = state.selected ? `Drawing number ${number} selected.` : `Drawing number ${number} removed from your selection.`;
  });

  refreshButton.addEventListener('click', () => refreshAvailability({ announce: true }));
  form.addEventListener('input', () => {
    state.reservationRequestId = '';
    if (!state.submitting) setStatus('');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.submitting) return;
    const details = customerDetails();
    if (details.error) {
      setStatus(details.error, 'error');
      details.field.focus();
      return;
    }
    if (!state.selected) {
      setStatus('Choose one available drawing number.', 'error');
      return;
    }
    setSubmitting(true);
    setStatus('Checking live availability…', 'info');
    try {
      if (!await refreshAvailability()) throw new Error('Current availability could not be confirmed. Please try again.');
      if (!state.selected) throw new Error('Your selected number is no longer available. Please choose another number.');
      if (!state.reservationRequestId) state.reservationRequestId = crypto.randomUUID();
      const response = await fetch(`${API_URL}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numbers: [state.selected],
          customerDetails: details,
          reservationRequestId: state.reservationRequestId
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.reservation) {
        if (response.status === 409) state.reservationRequestId = '';
        throw new Error(result.error || 'The number could not be reserved. Please try again.');
      }
      showConfirmation(result.reservation);
      await refreshAvailability();
    } catch (error) {
      setStatus(error.message || 'The number could not be reserved. Please try again.', 'error');
      setSubmitting(false);
      await refreshAvailability();
    }
  });

  function scheduleRefresh() {
    window.clearInterval(refreshTimer);
    if (document.hidden || !confirmation.hidden) return;
    refreshTimer = window.setInterval(() => refreshAvailability(), REFRESH_INTERVAL);
  }
  document.addEventListener('visibilitychange', scheduleRefresh);
  refreshAvailability().then(scheduleRefresh);
})();
