# MMM-TextClockRH

This MagicMirror module is a clock which shows the time as text.

![Screenshot of module](https://github.com/ngnijland/MMM-text-clock/raw/master/screenshots/MMM-text-clock-screenshot.png)

Compact mode:

![Screenshot of module in compact mode](https://github.com/ngnijland/MMM-text-clock/raw/master/screenshots/MMM-text-clock-screenshot-compact.png)

## Installation

1. Go to the MagicMirror modules folder

```bash
cd ~/MagicMirror/modules
```

2. Clone this repository

```bash
git clone https://github.com/rhodrihughes/MMM-TextClockRH.git
```

3. Install dependencies

```bash
cd MMM-TextClockRH
npm install
```

4. Add this module to the modules array in the MagicMirror `config/config.js` file, like this:

```javascript
modules: [
  {
    module: "MMM-TextClockRH",
    position: "middle_center"
  }
]
```

## Language

The text clock will match its language to MagicMirror's `language` config (documentation [here](https://docs.magicmirror.builders/getting-started/configuration.html#raspberry-specific)). When the configured language is not supported the module will fall back to English.
When using the `language` option, the config language is ignored.

Supported languages:
- Arabic
- Chinese
- English
- Spanish
- Dutch
- Finnish
- French
- Japanese
- Italian
- Swiss German
- German
- Turkish

## Configuration

Configure this module in your MagicMirror config file which is located at `config/config.js` in the MagicMirror repository. An example config for this module:

```javascript
modules: [
  {
    module: "MMM-TextClockRH",
    position: "middle_center",
    config: {
      language: "en",
      size: "medium",
      fontSize: "3vw",
      homeAssistant: {
        enabled: true,
        url: "http://homeassistant.local:8123",
        token: "your_long_lived_access_token",
        entityId: "input_boolean.screensaver",
      },
    }
  }
]
```

The following configurations are available:

Config                        | Type                                                     | Default value  | Description
:-----------------------------|:---------------------------------------------------------|:---------------|:------------
`compact`                     | `boolean`                                                | `false`        | Compact mode only shows highlighted letters
`size`                        | `xsmall \| small \| medium \| large`                     | `medium`       | Controls the spacing between letters in the grid
`fontSize`                    | `string` (CSS value)                                     | `null`         | Override the font size of the clock (e.g. `"3vw"`, `"36px"`, `"2rem"`). If not set, uses MagicMirror's default.
`dimmedColor`                 | `string` (CSS color)                                     | `"#333"`       | Color of the non-highlighted letters (e.g. `"#555"`, `"#1a1a1a"`, `"rgba(255,255,255,0.1)"`)
`language`                    | `string \| string[]`                                     | `en`           | A language or list of languages to alternate through. Overrides config language.
`languageAlternationInterval` | `number`                                                 | `60`           | Interval in minutes at which the language changes (> 0)
`fullscreen`                  | `boolean`                                                | `false`        | Fullscreen mode takes over your entire screen
`showMinutesIndicators`       | `boolean`                                                | `false`        | Shows a dot at each corner of the clock for every minute past the displayed time (e.g. 18 = quarter + 3 dots). Ignored in compact mode.
`homeAssistant`               | `object`                                                 | see below      | Home Assistant integration for screensaver mode
`screensaverFadeDuration`     | `number`                                                 | `1000`         | Duration in milliseconds for fade in/out transitions when screensaver activates/deactivates
`excludeModules`              | `string[]`                                               | `[]`           | Module names left visible during screensaver mode. Useful for overlay modules that should appear above the clock (e.g. `["MMM-IncomingCall"]`). These modules need a higher `z-index` than `9999` in their own CSS to render on top.

### Home Assistant Screensaver

The module can connect to Home Assistant and listen to a toggle entity (e.g. `input_boolean`). When the entity is turned on, all other modules fade out and the text clock takes over the full screen as a screensaver. When turned off, everything returns to normal.

This is useful for triggering a screensaver mode from HA automations — for example, when no motion is detected for a period of time.

#### Home Assistant Config

Config         | Type     | Default | Description
:--------------|:---------|:--------|:------------
`enabled`      | `boolean`| `false` | Enable or disable the HA connection
`url`          | `string` | `""`    | Your Home Assistant URL (e.g. `"http://homeassistant.local:8123"`)
`token`        | `string` | `""`    | A long-lived access token (create in HA → Profile → Security → Long-Lived Access Tokens)
`entityId`     | `string` | `""`    | The entity to watch (e.g. `"input_boolean.screensaver"`)

#### Home Assistant Setup

1. In Home Assistant, create an `input_boolean` helper (Settings → Devices & Services → Helpers → Create Helper → Toggle). Name it something like "Screensaver".

2. Create a long-lived access token: go to your HA Profile → Security → Long-Lived Access Tokens → Create Token. Copy the token.

3. Add the config to your MagicMirror module config as shown in the example above.

4. Optionally, create an automation in HA to toggle the screensaver based on motion sensors, time of day, etc.

#### Behaviour

- When the entity turns **on**: all other MagicMirror modules fade out, then the clock fades in fullscreen on a black background.
- When the entity turns **off**: the clock fades back to its normal size and position, then all other modules fade back in.
- The connection auto-reconnects if Home Assistant restarts or the connection drops.

## Todo
