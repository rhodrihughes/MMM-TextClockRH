/* Magic Mirror
 * Module: Text clock
 *
 * By Niek Nijland
 * MIT Licensed.
 */

Module.register('MMM-TextClockRH', {
  defaults: {
    compact: false,
    size: 'medium',
    fontSize: null,    // e.g. '2rem', '36px', '4vw' — overrides MM default font size
    dimmedColor: '#333', // color of non-highlighted letters (e.g. '#555', 'rgba(255,255,255,0.1)')
    fullscreen: false,
    showMinutesIndicators: false,
    languageAlternationInterval: 60,
    // Home Assistant screensaver config
    homeAssistant: {
      enabled: false,
      url: '',           // e.g. 'http://homeassistant.local:8123'
      token: '',         // Long-lived access token
      entityId: '',      // e.g. 'input_boolean.screensaver'
    },
    screensaverFadeDuration: 1000, // ms for fade in/out transitions
    // Module names to leave visible during screensaver mode (e.g. overlay
    // modules that should appear ABOVE the clock, like incoming call alerts).
    excludeModules: [],
  },

  supportedLanguages: ['ar', 'ch', 'de', 'en', 'es', 'fi', 'fr', 'it', 'jp', 'nl', 'tr'],

  start: function () {
    Log.info(`Starting module: ${this.name}`);

    this.compact = this.config.compact;
    this.language = config.language;
    this.showMinutesIndicators = this.config.showMinutesIndicators;
    this.languageAlternationInterval = this.config.languageAlternationInterval;
    this.size = this.config.size;
    this.fullscreen = this.config.fullscreen;
    this.screensaverActive = false;
    this.screensaverFadeDuration = this.config.screensaverFadeDuration;

    /*
     * Validate compact config
     */
    if (typeof this.compact !== 'boolean') {
      Log.error(
        `compact: ${this.compact} is not a boolean. Falling back to "false".`
      );
      this.compact = false;
    }

    /*
     * Validate size config
     */
    if (!['xsmall', 'small', 'medium', 'large'].includes(this.size)) {
      Log.error(
        `size: "${this.size}" is not a supported value. Please use "xsmall", "small", "medium" or "large". Falling back to "medium".`
      );
      this.size = 'medium';
    }

    /*
     * Validate fullscreen config
     */
    if (typeof this.fullscreen !== 'boolean') {
      Log.error(
        `fullscreen: ${this.fullscreen} is not a supported value. Please use a boolean.`
      );
      this.fullscreen = false;
    }

    /*
     * Validate fullscreen config in combination with compact config
     */
    if (this.fullscreen && this.compact) {
      Log.error(
        'fullscreen and compact can\'t both be true. Setting "fullscreen" to false'
      );
      this.fullscreen = false;
    }
    /*
      * Validate showMinutesIndicators config
     */
    if (typeof this.showMinutesIndicators !== 'boolean') {
      Log.error(
        `showMinutesIndicators: "${this.showMinutesIndicators}" is not a boolean. Falling back to "false".`
      );
      this.showMinutesIndicators = false;
    }

    /*
     * Validate language config
     */
    if (typeof this.config.language === 'string') {
      if (this.supportedLanguages.includes(this.config.language)) {
        this.language = this.config.language;
      } else {
        Log.error(
          `"${
            this.config.language
          }" is not a supported language. Falling back to config language (${
            config.language
          }). Supported languages: ${this.supportedLanguages.join(', ')}`
        );
      }
    } else if (Array.isArray(this.config.language)) {
      this.language = this.config.language.filter((language) => {
        const supported = this.supportedLanguages.includes(language);

        if (!supported) {
          Log.error(
            `"${language}" is not a supported language. Removing it from language alternation list. Supported languages: ${this.supportedLanguages.join(
              ', '
            )}`
          );
        }

        return supported;
      });

      if (this.language.length === 0) {
        Log.error(
          `No supported languages in language list. Falling back to config language (${config.language}).`
        );

        this.language = config.language;
      }
    }

    /*
     * Validate languageAlternationInterval config
     */
    if (typeof this.languageAlternationInterval !== 'number') {
      Log.error(
        `languageAlternationInterval: "${this.languageAlternationInterval}" is not a number. Falling back to "60".`
      );

      this.languageAlternationInterval = 60;
    }

    this.getActiveWords = undefined;
    this.gridColumns = 0;
    this.letters = [];
    this.words = [];
    this.wordMap = {};

    /*
     * Alternate through languages if configured
     */
    if (Array.isArray(this.language)) {
      let alternationIndex = 0;

      this.sendSocketNotification('SET_LANGUAGE', {
        id: this.identifier,
        language: this.language[alternationIndex],
      });

      setInterval(() => {
        alternationIndex++;

        if (alternationIndex >= this.language.length) {
          alternationIndex = 0;
        }

        this.sendSocketNotification('SET_LANGUAGE', {
          id: this.identifier,
          language: this.language[alternationIndex],
        });

        Log.info(
          'MMM-text-clock switched language to: ',
          this.language[alternationIndex]
        );
      }, this.languageAlternationInterval * 60 * 1000);
    } else {
      this.sendSocketNotification('SET_LANGUAGE', {
        id: this.identifier,
        language: this.language,
      });
    }

    /*
     * Connect to Home Assistant if configured
     */
    const ha = this.config.homeAssistant;
    if (ha && ha.enabled) {
      const missing = [];
      if (!ha.url) missing.push('url');
      if (!ha.token) missing.push('token');
      if (!ha.entityId) missing.push('entityId');

      if (missing.length === 0) {
        Log.info('MMM-TextClockRH: Home Assistant screensaver mode enabled');
        this.haScreensaverEnabled = true;
      } else {
        Log.error(
          `MMM-TextClockRH: Home Assistant enabled but missing required field(s): ${missing.join(', ')}. ` +
          'Check for typos (fields are case-sensitive, e.g. "token" not "Token").'
        );
        this.haScreensaverEnabled = false;
      }
    } else {
      this.haScreensaverEnabled = false;
    }
  },

  notificationReceived: function (notification) {
    // Once all modules are loaded and DOM is ready, hide ourselves if in HA screensaver mode
    if (notification === 'DOM_OBJECTS_CREATED' && this.haScreensaverEnabled) {
      if (!this.screensaverActive) {
        Log.info('MMM-TextClockRH: DOM ready - hiding clock until HA entity is on');
        this.hide(0, () => {});
      }
      // Now it's safe to connect to HA (node_helper socket is ready)
      const ha = this.config.homeAssistant;
      Log.info('MMM-TextClockRH: Sending HA_CONNECT to node_helper');
      this.sendSocketNotification('HA_CONNECT', {
        url: ha.url,
        token: ha.token,
        entityId: ha.entityId,
      });
    }
  },

  updateInterval: undefined,

  socketNotificationReceived: function (notification, payload) {
    if (notification === 'SET_LANGUAGE') {
      const revivedPayload = JSON.parse(payload, (_, value) => {
        if (typeof value === 'string' && value.indexOf('__FUNC__') === 0) {
          return eval(`(${value.slice(8)})`);
        }
        return value;
      });
      if (this.identifier !== revivedPayload.id) {
        return;
      }

      clearInterval(this.updateInterval);

      this.getActiveWords = revivedPayload.getActiveWords;
      this.gridColumns = revivedPayload.gridColumns;
      this.letters = revivedPayload.letters;
      this.words = revivedPayload.words;
      this.wordMap = revivedPayload.wordMap;
      this.currentLanguage = revivedPayload.language;
      this.domBuilt = false;
      this.updateDom();

      this.updateInterval = setInterval(() => {
        this.updateActiveLetters();
      }, 10000);
    }

    if (notification === 'HA_CONNECTED') {
      Log.info('MMM-TextClockRH: Connected to Home Assistant');
    }

    if (notification === 'HA_SCREENSAVER_STATE') {
      Log.info(`MMM-TextClockRH: Received screensaver state: ${payload.active ? 'ON' : 'OFF'}`);
      this.setScreensaverMode(payload.active);
    }

    if (notification === 'HA_ERROR') {
      Log.error(`MMM-TextClockRH: HA Error - ${payload.message}`);
    }
  },

  updateActiveLetters: function () {
    if (!this.domBuilt || this.compact) {
      this.updateDom();
      return;
    }

    const theTimeNow = new Date();
    const activeWords = this.getActiveWords(theTimeNow);

    if (this.letters) {
      const letterIndexes = activeWords.reduce(
        (acc, word) => [...acc, ...word],
        []
      );
      const letterSpans = this.letterElements;
      if (letterSpans) {
        letterSpans.forEach((span, index) => {
          if (letterIndexes.includes(index)) {
            span.classList.add('bright');
          } else {
            span.classList.remove('bright');
          }
        });
      }
    } else {
      const activeWordsList = activeWords.flat(1);
      const wordSpans = this.wordElements;
      if (wordSpans) {
        wordSpans.forEach((item) => {
          const isActive = activeWordsList.some(
            (active) => active[0] === item.line && active[1] === item.word
          );
          if (isActive) {
            item.element.classList.add('bright');
          } else {
            item.element.classList.remove('bright');
          }
        });
      }
    }

    // Update minute dots
    this.dotMinutes = theTimeNow.getMinutes() % 5;
    if (this.showMinutesIndicators && this.dotElements) {
      this.dotElements.forEach((dot, i) => {
        const dotNum = [1, 2, 4, 3][i];
        if (this.dotMinutes >= dotNum) {
          dot.classList.remove('minutedot-transparent');
          dot.classList.add('minutedot');
        } else {
          dot.classList.remove('minutedot');
          dot.classList.add('minutedot-transparent');
        }
      });
    }
  },

  setScreensaverMode: function (active) {
    if (this.screensaverActive === active) return;
    this.screensaverActive = active;

    const fadeDuration = this.screensaverFadeDuration;

    if (active) {
      Log.info('MMM-TextClockRH: Activating screensaver mode');

      // Fade out all other modules, except ones the user wants left visible
      // (e.g. overlay modules that should appear above the clock).
      const excluded = this.config.excludeModules || [];
      MM.getModules().enumerate((module) => {
        if (module.identifier !== this.identifier && !excluded.includes(module.name)) {
          module.hide(fadeDuration, () => {}, { lockString: 'MMM-TextClockRH-screensaver' });
        }
      });

      // After other modules have faded out, show the clock centered on black.
      // Note: we intentionally do NOT set this.fullscreen (grid--fullscreen);
      // the screensaver-active wrapper handles the fullscreen black background
      // and centers the grid at its natural size.
      setTimeout(() => {
        this.fullscreen = false;
        this.compact = false;
        this.domBuilt = false;

        const wrapper = document.querySelector(`.module.MMM-TextClockRH`);
        if (wrapper) {
          wrapper.classList.add('screensaver-active');
        }

        this.updateDom(0);
        this.show(fadeDuration, () => {});
      }, fadeDuration);
    } else {
      Log.info('MMM-TextClockRH: Deactivating screensaver mode');

      // Hide the clock first
      this.hide(fadeDuration, () => {});

      // After clock has faded out, restore and show other modules
      setTimeout(() => {
        const wrapper = document.querySelector(`.module.MMM-TextClockRH`);
        if (wrapper) {
          wrapper.classList.remove('screensaver-active');
        }

        this.fullscreen = this.config.fullscreen;
        this.compact = this.config.compact;
        this.size = this.config.size;
        this.domBuilt = false;
        this.updateDom(0);

        const excluded = this.config.excludeModules || [];
        MM.getModules().enumerate((module) => {
          if (module.identifier !== this.identifier && !excluded.includes(module.name)) {
            module.show(fadeDuration, () => {}, { lockString: 'MMM-TextClockRH-screensaver' });
          }
        });
      }, fadeDuration);
    }
  },

  getDom: function () {
    if (typeof this.getActiveWords !== 'function') {
      return document.createElement('div');
    }
    const grid = document.createElement('div');
    grid.classList.add(this.compact ? 'bright' : 'dimmed');
    grid.classList.add(this.size);
    grid.classList.add('lang_' + this.currentLanguage);

    if (!this.compact) {
      grid.classList.add('grid');
      grid.style.gridTemplateColumns = `repeat(${
        this.gridColumns + (this.showMinutesIndicators ? 2 : 0)
      }, 1fr)`;

      switch (this.size) {
        case 'xsmall': {
          grid.classList.add('grid--gap-xsmall');
          break;
        }
        case 'small': {
          grid.classList.add('grid--gap-small');
          break;
        }
        case 'large': {
          grid.classList.add('grid--gap-large');
          break;
        }
        default: {
          grid.classList.add('grid--gap-medium');
        }
      }
    }

    if (this.fullscreen) {
      grid.classList.add('grid--fullscreen');
    }

    if (this.config.fontSize) {
      grid.style.fontSize = this.config.fontSize;
    }

    if (!this.compact && this.config.dimmedColor) {
      grid.style.color = this.config.dimmedColor;
    }

    const theTimeNow = new Date();
    this.dotMinutes = theTimeNow.getMinutes() % 5;
    const activeWords = this.getActiveWords(theTimeNow);

    // Store references for animation updates
    this.letterElements = [];
    this.wordElements = [];
    this.dotElements = [];

    if (this.letters) {
      // Original mode, letter grid
      grid.classList.add('letters');
      if (this.compact) {
        grid.textContent = activeWords
          .map((word) => word.map((letter) => this.letters[letter]).join(''))
          .join(' ');
      } else {
        if (this.showMinutesIndicators) {
          const dot1 = document.createElement('span');
          dot1.classList.add(
            this.dotMinutes < 1 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot1);
          grid.appendChild(dot1);
          for (let index = 0; index < this.gridColumns; index++) {
            grid.appendChild(document.createElement('span'));
          }
          const dot2 = document.createElement('span');
          dot2.classList.add(
            this.dotMinutes < 2 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot2);
          grid.appendChild(dot2);
        }
        const letterIndexes = activeWords.reduce(
          (acc, word) => [...acc, ...word],
          []
        );
        this.letters.forEach((letter, index) => {
          if (this.showMinutesIndicators && index % this.gridColumns === 0) {
            grid.appendChild(document.createElement('span'));
          }
          const element = document.createElement('span');

          letterIndexes.includes(index) && element.classList.add('bright');
          element.textContent = letter;
          this.letterElements.push(element);

          grid.appendChild(element);
          if (
            this.showMinutesIndicators &&
            index % this.gridColumns === this.gridColumns - 1
          ) {
            grid.appendChild(document.createElement('span'));
          }
        });
        if (this.showMinutesIndicators) {
          const dot4 = document.createElement('span');
          dot4.classList.add(
            this.dotMinutes < 4 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot4);
          grid.appendChild(dot4);
          for (let index = 0; index < this.gridColumns; index++) {
            grid.appendChild(document.createElement('span'));
          }
          const dot3 = document.createElement('span');
          dot3.classList.add(
            this.dotMinutes < 3 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot3);
          grid.appendChild(dot3);
        }
      }
    } else {
      // Word mode
      const activeWordsList = activeWords.flat(1);

      if (this.compact) {
        grid.textContent = activeWordsList
          .map((word) => this.words[word[0]][word[1]])
          .join(' ');
      } else {
        grid.classList.add('wordlayout');
        if (this.showMinutesIndicators) {
          const dot1 = document.createElement('span');
          dot1.classList.add(
            this.dotMinutes < 1 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot1);
          grid.appendChild(dot1);
          grid.appendChild(document.createElement('span'));
          const dot2 = document.createElement('span');
          dot2.classList.add(
            this.dotMinutes < 2 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot2);
          grid.appendChild(dot2);
        }
        this.words.forEach((line, indexLine) => {
          if (this.showMinutesIndicators) {
            grid.appendChild(document.createElement('span'));
          }
          const lineElement = document.createElement('span');
          lineElement.classList.add('wordrow');

          line.forEach((word, indexWord) => {
            const wordElement = document.createElement('span');
            wordElement.textContent = word;

            if (
              activeWordsList.some((item) => {
                return item[0] === indexLine && item[1] === indexWord;
              })
            ) {
              wordElement.classList.add('bright');
            }
            this.wordElements.push({ element: wordElement, line: indexLine, word: indexWord });
            lineElement.appendChild(wordElement);
          });
          grid.appendChild(lineElement);
          if (this.showMinutesIndicators) {
            grid.appendChild(document.createElement('span'));
          }
        });
        if (this.showMinutesIndicators) {
          const dot4 = document.createElement('span');
          dot4.classList.add(
            this.dotMinutes < 4 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot4);
          grid.appendChild(dot4);
          grid.appendChild(document.createElement('span'));
          const dot3 = document.createElement('span');
          dot3.classList.add(
            this.dotMinutes < 3 ? 'minutedot-transparent' : 'minutedot'
          );
          this.dotElements.push(dot3);
          grid.appendChild(dot3);
        }
      }
    }
    this.domBuilt = true;
    return grid;
  },

  getStyles: function () {
    return [this.file('MMM-TextClockRH.css')];
  },

  /*
   * Centralise the time display function in a manner that suits most languages
   * This function returns
   *   morning: a boolean which replicates the behaviour of AM/PM in english
   *   hours_to_display: the hour to display 12h format (past 30' on the hour = the next hour)
   *   minutes_to_display: in 5 minute increment, negative is "to the hour", positive is "past the hour"
   */
  displayTime: function (time) {
    const hours = time.getHours();
    const minutes = time.getMinutes();
    let displayHour = 0;
    let normalizedMinutes = 0;

    if (this.showMinutesIndicators && !this.compact) {
      // Rounding to the immediately lower 5 minute increment
      if (minutes >= 5 && minutes < 10) {
        normalizedMinutes = 5;
      } else if (minutes >= 55 && minutes <= 59) {
        normalizedMinutes = -5;
      } else if (minutes >= 10 && minutes < 15) {
        normalizedMinutes = 10;
      } else if (minutes >= 50 && minutes < 55) {
        normalizedMinutes = -10;
      } else if (minutes >= 15 && minutes < 20) {
        normalizedMinutes = 15;
      } else if (minutes >= 45 && minutes < 50) {
        normalizedMinutes = -15;
      } else if (minutes >= 20 && minutes < 25) {
        normalizedMinutes = 20;
      } else if (minutes >= 40 && minutes < 45) {
        normalizedMinutes = -20;
      } else if (minutes >= 25 && minutes < 30) {
        normalizedMinutes = 25;
      } else if (minutes >= 35 && minutes < 40) {
        normalizedMinutes = -25;
      } else if (minutes >= 30 && minutes < 35) {
        normalizedMinutes = 30;
      }

      // If displaying minutes to the hour : bump the hour one notch
      displayHour = (normalizedMinutes < 0 ? hours + 1 : hours) % 24;

    } else {
      // Original rounding algorithm, rounding to the closest 5 minute increment
      if (minutes >= 3 && minutes <= 7) {
        normalizedMinutes = 5;
      } else if (minutes >= 53 && minutes <= 57) {
        normalizedMinutes = -5;
      } else if (minutes >= 8 && minutes <= 12) {
        normalizedMinutes = 10;
      } else if (minutes >= 48 && minutes <= 52) {
        normalizedMinutes = -10;
      } else if (minutes >= 13 && minutes <= 17) {
        normalizedMinutes = 15;
      } else if (minutes >= 43 && minutes <= 47) {
        normalizedMinutes = -15;
      } else if (minutes >= 18 && minutes <= 22) {
        normalizedMinutes = 20;
      } else if (minutes >= 38 && minutes <= 42) {
        normalizedMinutes = -20;
      } else if (minutes >= 23 && minutes <= 27) {
        normalizedMinutes = 25;
      } else if (minutes >= 33 && minutes <= 37) {
        normalizedMinutes = -25;
      } else if (minutes >= 28 && minutes <= 32) {
        normalizedMinutes = 30;
      }

      // If displaying minutes to the hour : bump the hour one notch
      displayHour = (minutes >= 33 ? hours + 1 : hours) % 24;

    }


    // use 12 hour format
    const normalizedHour = displayHour > 12 ? displayHour - 12 : displayHour;
    const minutesFromMidnight = hours * 60 + minutes;
    const morning =
      this.showMinutesIndicators && !this.compact
        ? minutesFromMidnight <= 750 && minutesFromMidnight >= 35
        : minutesFromMidnight < 753 && minutesFromMidnight >= 33;
    return {
      morning: morning,
      hours_to_display: normalizedHour,
      minutes_to_display: normalizedMinutes,
    };
  },
});
