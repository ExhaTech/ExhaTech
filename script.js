/* Exha Technologies — site interactions */
(function () {
  'use strict';

  // ---- Year in footer ----
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---- Mobile nav toggle ----
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // close after clicking a link
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---- Scroll reveal ----
  var revealTargets = document.querySelectorAll(
    '.section-head, .card, .mini-card, .steps li, .hero-copy, .hero-art, .why-art, .check-list, .contact-form, .contact-info'
  );
  revealTargets.forEach(function (el) { el.classList.add('reveal'); });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('visible'); });
  }

  // Yurguen: acceso oculto al módulo de cobros — 5 clics rápidos en el badge del footer
  var badge = document.querySelector('.footer-bottom .badge');
  var badgeClicks = 0;
  var badgeTimer = null;
  if (badge) {
    badge.style.cursor = 'default';
    badge.addEventListener('click', function () {
      badgeClicks += 1;
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(function () { badgeClicks = 0; }, 2500);
      if (badgeClicks >= 5) {
        badgeClicks = 0;
        window.location.href = 'eh-mnt.html';
      }
    });
  }

  // ---- Contact form (frontend-only demo) ----
  var form = document.getElementById('contactForm');
  var status = document.getElementById('formStatus');
  if (form && status) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';

      var name = form.name.value.trim();
      var email = form.email.value.trim();
      var message = form.message.value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      if (!name || !emailOk || !message) {
        status.classList.add('error');
        status.textContent = 'Por favor revisa los campos requeridos.';
        return;
      }

      // Simulate sending
      var btn = form.querySelector('button[type="submit"]');
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Enviando...';

      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = original;
        status.classList.add('ok');
        status.textContent = '¡Gracias! Te contactaremos muy pronto.';
        form.reset();
      }, 900);
    });
  }
})();
