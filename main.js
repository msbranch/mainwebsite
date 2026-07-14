const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => { navLinks.classList.toggle('open'); });
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// Mailing list signup — posts to a Zapier Catch Hook (later wired to GHL).
// Replace the form's data-endpoint value (#MAILING_LIST_WEBHOOK_URL) with the
// real Zapier "Catch Hook" URL to go live.
const mailForm = document.getElementById('mailForm');
if (mailForm) {
  const emailInput = document.getElementById('mailEmail');
  const msg = document.getElementById('mailMsg');
  const submitBtn = mailForm.querySelector('button[type="submit"]');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  mailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = (emailInput.value || '').trim();

    if (!EMAIL_RE.test(email)) {
      msg.textContent = 'Please enter a valid email address.';
      msg.className = 'mail-msg mail-msg--error';
      return;
    }

    const endpoint = mailForm.getAttribute('data-endpoint') || '';
    const configured = endpoint && endpoint.indexOf('#') !== 0;
    submitBtn.disabled = true;

    if (configured) {
      try {
        await fetch(endpoint, {
          method: 'POST',
          mode: 'no-cors',
          body: new URLSearchParams({
            email: email,
            source: 'morganbranch.co',
            submitted_at: new Date().toISOString()
          })
        });
      } catch (err) {
        // Opaque/no-cors responses don't throw on success; ignore transient errors.
      }
    }

    mailForm.reset();
    submitBtn.disabled = false;
    msg.textContent = "You're on the list. Watch your inbox.";
    msg.className = 'mail-msg mail-msg--ok';
  });
}

// Float-in animation: reveal elements as they scroll into view.
const revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('is-visible'));
}
