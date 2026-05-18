/**
 * i18n.js
 * Internationalization module for Timestamp Converter.
 *
 * Uses Chrome's built-in i18n API (chrome.i18n) for message lookup,
 * which automatically selects the right _locales/<lang>/messages.json.
 *
 * For contexts where chrome.i18n is unavailable (e.g., unit tests),
 * a fallback mechanism reads from a bundled English map.
 *
 * To add a new language:
 *   1. Create _locales/<lang_code>/messages.json
 *   2. Translate all keys from _locales/en/messages.json
 *   3. Chrome will automatically serve the correct file based on browser locale.
 *
 * Language selection override is stored in chrome.storage.local under "language".
 * When overridden, we dynamically load the messages.json for that locale and
 * cache it in memory for the session.
 */

const i18n = (() => {
  // ── Supported locales ──────────────────────────────────────────────────────
  // Maps display name (native) → BCP 47 / Chrome locale code
  const SUPPORTED_LOCALES = [
    { code: "af",       name: "Afrikaans" },
    { code: "sq",       name: "Shqip" },
    { code: "am",       name: "አማርኛ" },
    { code: "ar",       name: "العربية" },
    { code: "hy",       name: "Հայերեն" },
    { code: "as",       name: "অসমীয়া" },
    { code: "ay",       name: "Aymar" },
    { code: "az",       name: "Azərbaycan" },
    { code: "bm",       name: "Bamanankan" },
    { code: "eu",       name: "Euskara" },
    { code: "be",       name: "Беларуская" },
    { code: "bn",       name: "বাংলা" },
    { code: "bho",      name: "भोजपुरी" },
    { code: "bs",       name: "Bosanski" },
    { code: "bg",       name: "Български" },
    { code: "ca",       name: "Català" },
    { code: "ceb",      name: "Cebuano" },
    { code: "ny",       name: "Chichewa" },
    { code: "zh_CN",    name: "中文（简体）" },
    { code: "zh_TW",    name: "中文（繁體）" },
    { code: "co",       name: "Corsu" },
    { code: "hr",       name: "Hrvatski" },
    { code: "cs",       name: "Čeština" },
    { code: "da",       name: "Dansk" },
    { code: "dv",       name: "ދިވެހި" },
    { code: "doi",      name: "डोगरी" },
    { code: "nl",       name: "Nederlands" },
    { code: "en",       name: "English" },
    { code: "eo",       name: "Esperanto" },
    { code: "et",       name: "Eesti" },
    { code: "ee",       name: "Eʋegbe" },
    { code: "fil",      name: "Filipino" },
    { code: "fi",       name: "Suomi" },
    { code: "fr",       name: "Français" },
    { code: "fy",       name: "Frysk" },
    { code: "gl",       name: "Galego" },
    { code: "ka",       name: "ქართული" },
    { code: "de",       name: "Deutsch" },
    { code: "el",       name: "Ελληνικά" },
    { code: "gn",       name: "Avañeẽ" },
    { code: "gu",       name: "ગુજરાતી" },
    { code: "ht",       name: "Kreyòl ayisyen" },
    { code: "ha",       name: "Hausa" },
    { code: "haw",      name: "ʻŌlelo Hawaiʻi" },
    { code: "iw",       name: "עברית" },
    { code: "hi",       name: "हिन्दी" },
    { code: "hmn",      name: "Hmong" },
    { code: "hu",       name: "Magyar" },
    { code: "is",       name: "Íslenska" },
    { code: "ig",       name: "Igbo" },
    { code: "ilo",      name: "Ilocano" },
    { code: "id",       name: "Indonesia" },
    { code: "ga",       name: "Gaeilge" },
    { code: "it",       name: "Italiano" },
    { code: "ja",       name: "日本語" },
    { code: "jw",       name: "Basa Jawa" },
    { code: "kn",       name: "ಕನ್ನಡ" },
    { code: "kk",       name: "Қазақ" },
    { code: "km",       name: "ខ្មែរ" },
    { code: "rw",       name: "Kinyarwanda" },
    { code: "gom",      name: "कोंकणी" },
    { code: "ko",       name: "한국어" },
    { code: "kri",      name: "Krio" },
    { code: "ku",       name: "Kurdî (Kurmancî)" },
    { code: "ckb",      name: "کوردی (سۆرانی)" },
    { code: "ky",       name: "Кыргызча" },
    { code: "lo",       name: "ລາວ" },
    { code: "la",       name: "Latina" },
    { code: "lv",       name: "Latviešu" },
    { code: "ln",       name: "Lingála" },
    { code: "lt",       name: "Lietuvių" },
    { code: "lg",       name: "Luganda" },
    { code: "lb",       name: "Lëtzebuergesch" },
    { code: "mk",       name: "Македонски" },
    { code: "mai",      name: "मैथिली" },
    { code: "mg",       name: "Malagasy" },
    { code: "ms",       name: "Melayu" },
    { code: "ml",       name: "മലയാളം" },
    { code: "mt",       name: "Malti" },
    { code: "mi",       name: "Māori" },
    { code: "mr",       name: "मराठी" },
    { code: "mni",      name: "ꯃꯤꯇꯩꯂꯣꯟ" },
    { code: "lus",      name: "Mizo ṭawng" },
    { code: "mn",       name: "Монгол" },
    { code: "my",       name: "မြန်မာ" },
    { code: "ne",       name: "नेपाली" },
    { code: "no",       name: "Norsk" },
    { code: "or",       name: "ଓଡ଼ିଆ" },
    { code: "om",       name: "Afaan Oromoo" },
    { code: "ps",       name: "پښتو" },
    { code: "fa",       name: "فارسی" },
    { code: "pl",       name: "Polski" },
    { code: "pt",       name: "Português" },
    { code: "pa",       name: "ਪੰਜਾਬੀ" },
    { code: "qu",       name: "Qichwa" },
    { code: "ro",       name: "Română" },
    { code: "ru",       name: "Русский" },
    { code: "sm",       name: "Gagana Samoa" },
    { code: "sa",       name: "संस्कृत" },
    { code: "gd",       name: "Gàidhlig" },
    { code: "nso",      name: "Sepedi" },
    { code: "sr",       name: "Српски" },
    { code: "st",       name: "Sesotho" },
    { code: "sn",       name: "ChiShona" },
    { code: "sd",       name: "سنڌي" },
    { code: "si",       name: "සිංහල" },
    { code: "sk",       name: "Slovenčina" },
    { code: "sl",       name: "Slovenščina" },
    { code: "so",       name: "Soomaali" },
    { code: "es",       name: "Español" },
    { code: "su",       name: "Basa Sunda" },
    { code: "sw",       name: "Kiswahili" },
    { code: "sv",       name: "Svenska" },
    { code: "tg",       name: "Тоҷикӣ" },
    { code: "ta",       name: "தமிழ்" },
    { code: "tt",       name: "Татар" },
    { code: "te",       name: "తెలుగు" },
    { code: "th",       name: "ภาษาไทย" },
    { code: "ti",       name: "ትግርኛ" },
    { code: "ts",       name: "Xitsonga" },
    { code: "tr",       name: "Türkçe" },
    { code: "tk",       name: "Türkmen" },
    { code: "tw",       name: "Twi" },
    { code: "uk",       name: "Українська" },
    { code: "ur",       name: "اردو" },
    { code: "ug",       name: "ئۇيغۇرچە" },
    { code: "uz",       name: "O'zbek" },
    { code: "vi",       name: "Tiếng Việt" },
    { code: "cy",       name: "Cymraeg" },
    { code: "xh",       name: "isiXhosa" },
    { code: "yi",       name: "ייִדיש" },
    { code: "yo",       name: "Yorùbá" },
    { code: "zu",       name: "isiZulu" }
  ];

  // ── In-memory message cache for overridden locale ──────────────────────────
  let _overrideMessages = null;
  let _currentLocale = "en";

  // ── RTL locales ────────────────────────────────────────────────────────────
  const RTL_LOCALES = new Set([
    "ar", "iw", "fa", "ur", "ug", "sd", "ckb", "ps", "dv", "yi"
  ]);

  // ── Public: get a translated message ──────────────────────────────────────
  /**
   * Get a translated message by key.
   * @param {string} key  - The message key from messages.json
   * @param {string[]} [substitutions] - Optional substitution strings
   * @returns {string}
   */
  function getMessage(key, substitutions) {
    // If we have a runtime override cache loaded, use it
    if (_overrideMessages && _overrideMessages[key]) {
      let msg = _overrideMessages[key].message || "";
      if (substitutions && substitutions.length) {
        substitutions.forEach((sub, i) => {
          msg = msg.replace(new RegExp(`\\$${i + 1}`, "g"), sub);
        });
      }
      return msg;
    }

    // Default: use Chrome's built-in i18n
    if (
      typeof chrome !== "undefined" &&
      chrome.i18n &&
      typeof chrome.i18n.getMessage === "function"
    ) {
      const result = chrome.i18n.getMessage(key, substitutions);
      // chrome.i18n.getMessage returns "" for missing keys
      return result || key;
    }

    // Fallback for test/non-extension environments
    return key;
  }

  // ── Public: get current UI locale ─────────────────────────────────────────
  function getCurrentLocale() {
    return _currentLocale;
  }

  // ── Public: is current locale RTL? ────────────────────────────────────────
  function isRTL(locale) {
    const loc = locale || _currentLocale;
    return RTL_LOCALES.has(loc);
  }

  // ── Public: get all supported locales ─────────────────────────────────────
  function getSupportedLocales() {
    return SUPPORTED_LOCALES;
  }

  // ── Public: initialise i18n ────────────────────────────────────────────────
  /**
   * Initialise the i18n module.
   * Reads saved language preference from storage.
   * If it matches browser locale, no override is needed.
   * Otherwise, fetches and caches the messages.json for that locale.
   * @returns {Promise<void>}
   */
  async function init() {
    // Detect browser locale (Chrome provides this automatically)
    const browserLocale =
      typeof chrome !== "undefined" && chrome.i18n
        ? chrome.i18n.getUILanguage()
        : navigator.language || "en";

    _currentLocale = browserLocale;

    // Check for user-saved language preference
    const saved = await _loadSavedLocale();
    if (saved && saved !== browserLocale) {
      await _loadLocaleMessages(saved);
    }

    // Apply text direction
    _applyDirection();

    // Translate all static DOM elements
    _translateDOM();
  }

  // ── Public: change language at runtime ────────────────────────────────────
  /**
   * Switch to a different locale at runtime.
   * Saves preference and reloads messages.
   * @param {string} localeCode
   * @returns {Promise<void>}
   */
  async function setLocale(localeCode) {
    if (localeCode === _currentLocale && _overrideMessages) return;

    await _loadLocaleMessages(localeCode);
    await _saveLocale(localeCode);
    _applyDirection();
    _translateDOM();

    // Dispatch event so other modules can react
    document.dispatchEvent(
      new CustomEvent("localeChanged", { detail: { locale: localeCode } })
    );
  }

  // ── Private: load locale messages via fetch ────────────────────────────────
  async function _loadLocaleMessages(localeCode) {
    try {
      const url = chrome.runtime.getURL(
        `_locales/${localeCode}/messages.json`
      );
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      _overrideMessages = await response.json();
      _currentLocale = localeCode;
    } catch (err) {
      console.warn(
        `[i18n] Could not load messages for locale "${localeCode}":`,
        err.message
      );
      // Fall back to Chrome's built-in (browser locale)
      _overrideMessages = null;
    }
  }

  // ── Private: persist locale to storage ────────────────────────────────────
  function _saveLocale(localeCode) {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.set({ language: localeCode }, resolve);
      } else {
        try {
          localStorage.setItem("ts_language", localeCode);
        } catch (_) {}
        resolve();
      }
    });
  }

  // ── Private: load persisted locale from storage ───────────────────────────
  function _loadSavedLocale() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.get("language", (result) => {
          resolve(result.language || null);
        });
      } else {
        resolve(localStorage.getItem("ts_language") || null);
      }
    });
  }

  // ── Private: translate all [data-i18n] elements in the DOM ────────────────
  function _translateDOM() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const attr = el.getAttribute("data-i18n-attr"); // e.g. "placeholder"
      const translated = getMessage(key);
      if (!translated || translated === key) return;

      if (attr) {
        el.setAttribute(attr, translated);
      } else {
        // Preserve child elements (e.g. icons inside buttons)
        const textNodes = Array.from(el.childNodes).filter(
          (n) => n.nodeType === Node.TEXT_NODE
        );
        if (textNodes.length > 0) {
          textNodes[0].textContent = translated;
        } else {
          el.textContent = translated;
        }
      }
    });

    // Update document language attribute
    document.documentElement.lang = _currentLocale;
  }

  // ── Private: apply LTR/RTL direction ──────────────────────────────────────
  function _applyDirection() {
    const dir = isRTL(_currentLocale) ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.setAttribute("data-dir", dir);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    getMessage,
    setLocale,
    getCurrentLocale,
    getSupportedLocales,
    isRTL,
    // Shorthand alias used throughout the codebase
    t: getMessage,
  };
})();

export default i18n;