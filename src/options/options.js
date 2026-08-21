/*
 * options.js — Lie les controles de la page d'options au storage (via CMExt)
 * et applique les libelles i18n. Sauvegarde automatique a chaque changement.
 */
(function () {
  "use strict";

  var CMExt = window.CMExt;

  // ---- i18n : remplit chaque [data-i18n] avec le message de la locale active --
  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var msg = chrome.i18n.getMessage(key);
      if (msg) el.textContent = msg;
    });
  }

  // ---- Liaison controles <-> reglages --------------------------------------
  function controls() {
    return Array.prototype.slice.call(
      document.querySelectorAll("[data-setting]")
    );
  }

  function readControl(el) {
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number") {
      // Le pas decide du type : `step="0.01"` autorise les decimales (montant
      // de sous-cotation), sinon on reste sur des entiers (quantites, pas).
      var decimal = el.step && el.step !== "1" && parseFloat(el.step) < 1;
      var min = el.min === "" ? 1 : parseFloat(el.min);
      var value = decimal ? parseFloat(el.value) : parseInt(el.value, 10);
      if (isNaN(value)) value = min;
      return Math.max(min, value);
    }
    return el.value;
  }

  function writeControl(el, value) {
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  }

  var statusTimer = null;
  function flashSaved() {
    var status = document.getElementById("status");
    status.textContent = chrome.i18n.getMessage("saved") || "Saved";
    status.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      status.classList.remove("show");
    }, 1200);
  }

  function hydrate(settings) {
    controls().forEach(function (el) {
      writeControl(el, settings[el.getAttribute("data-setting")]);
    });
  }

  function bind() {
    controls().forEach(function (el) {
      el.addEventListener("change", function () {
        var partial = {};
        partial[el.getAttribute("data-setting")] = readControl(el);
        CMExt.setSettings(partial).then(flashSaved);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyI18n();
    CMExt.getSettings().then(hydrate).then(bind);
    // Reflete les changements faits ailleurs (autre onglet d'options, etc.).
    CMExt.onChange(hydrate);
  });
})();
