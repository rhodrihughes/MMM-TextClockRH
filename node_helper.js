const NodeHelper = require('node_helper');
const locale = require('./locale');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  // Fallback: resolve from MagicMirror's node_modules (handles symlinked modules)
  WebSocket = require(require('path').resolve(__dirname, '..', '..', 'node_modules', 'ws'));
}

module.exports = NodeHelper.create({
  haConnection: null,
  haMessageId: 1,
  haAuthenticated: false,
  haSubscriptionId: null,
  haStateRequestId: null,
  haEntityId: null,
  haReconnectTimer: null,
  haLastState: null,

  socketNotificationReceived: function (notification, payload) {
    console.log(`MMM-TextClockRH node_helper received: ${notification}`);

    if (notification === 'SET_LANGUAGE') {
      this.sendSocketNotification(
        'SET_LANGUAGE',
        JSON.stringify(
          Object.assign({}, payload, locale[payload.language]),
          (_, value) => {
            if (typeof value === 'function') {
              return '__FUNC__' + value.toString();
            }

            return value;
          },
          2
        )
      );
    }

    if (notification === 'HA_CONNECT') {
      this.haEntityId = payload.entityId;
      this.connectToHA(payload.url, payload.token, payload.entityId);
    }
  },

  connectToHA: function (url, token, entityId) {
    // Tear down any existing connection cleanly
    if (this.haConnection) {
      try {
        this.haConnection.removeAllListeners();
        this.haConnection.close();
      } catch (e) { /* ignore */ }
      this.haConnection = null;
    }

    if (this.haReconnectTimer) {
      clearTimeout(this.haReconnectTimer);
      this.haReconnectTimer = null;
    }

    this.haAuthenticated = false;
    this.haMessageId = 1;
    this.haInitialStateReceived = false;

    const wsUrl = url.replace(/^http/, 'ws') + '/api/websocket';
    console.log(`MMM-TextClockRH: Connecting to Home Assistant at ${wsUrl}`);

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error(`MMM-TextClockRH: Failed to create WebSocket: ${err.message}`);
      this.scheduleReconnect(url, token, entityId);
      return;
    }

    this.haConnection = ws;

    ws.on('open', () => {
      console.log('MMM-TextClockRH: WebSocket connected to Home Assistant');
    });

    ws.on('message', (data) => {
      // Ignore messages from a stale socket (e.g. after a reconnect)
      if (ws !== this.haConnection) return;

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        console.error(`MMM-TextClockRH: Failed to parse HA message: ${err.message}`);
        return;
      }
      this.handleHAMessage(ws, msg, token, entityId);
    });

    ws.on('error', (err) => {
      console.error(`MMM-TextClockRH: WebSocket error: ${err.message}`);
    });

    ws.on('close', () => {
      console.log('MMM-TextClockRH: WebSocket closed');
      if (ws === this.haConnection) {
        this.haAuthenticated = false;
        this.haConnection = null;
        this.scheduleReconnect(url, token, entityId);
      }
    });
  },

  // Safe send that only writes to an open socket
  safeSend: function (ws, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('MMM-TextClockRH: Tried to send on a closed/invalid socket, skipping');
      return false;
    }
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error(`MMM-TextClockRH: Send failed: ${err.message}`);
      return false;
    }
  },

  handleHAMessage: function (ws, msg, token, entityId) {
    switch (msg.type) {
      case 'auth_required':
        console.log('MMM-TextClockRH: HA auth required, sending token...');
        this.safeSend(ws, { type: 'auth', access_token: token });
        break;

      case 'auth_ok':
        console.log('MMM-TextClockRH: ✓ Authenticated with Home Assistant successfully');
        this.haAuthenticated = true;
        this.sendSocketNotification('HA_CONNECTED', {});
        this.fetchEntityState(ws, entityId);
        this.subscribeToEntity(ws);
        break;

      case 'auth_invalid':
        console.error('MMM-TextClockRH: ✗ Authentication failed - check your access token');
        this.sendSocketNotification('HA_ERROR', { message: 'Authentication failed' });
        break;

      case 'result':
        // Initial get_states response: an array of all entity states
        if (msg.id === this.haStateRequestId && msg.success && Array.isArray(msg.result)) {
          const entity = msg.result.find((e) => e.entity_id === entityId);
          if (entity) {
            const isActive = entity.state === 'on';
            console.log(`MMM-TextClockRH: [initial state] "${entityId}" = "${entity.state}" → screensaver ${isActive ? 'ON' : 'OFF'}`);
            this.haLastState = isActive;
            this.sendSocketNotification('HA_SCREENSAVER_STATE', { active: isActive });
          } else {
            console.error(`MMM-TextClockRH: Entity "${entityId}" not found in Home Assistant`);
          }
        }
        break;

      case 'event':
        if (msg.event && msg.event.data) {
          const newState = msg.event.data.new_state;
          if (newState && newState.entity_id === entityId) {
            const isActive = newState.state === 'on';
            console.log(`MMM-TextClockRH: [event] Entity "${entityId}" changed to "${newState.state}" → screensaver ${isActive ? 'ON' : 'OFF'}`);
            if (this.haLastState !== isActive) {
              this.haLastState = isActive;
              this.sendSocketNotification('HA_SCREENSAVER_STATE', { active: isActive });
            }
          }
        }
        break;

      default:
        break;
    }
  },

  fetchEntityState: function (ws, entityId) {
    if (!this.haAuthenticated) return;
    console.log(`MMM-TextClockRH: Fetching initial state for "${entityId}"...`);
    this.haStateRequestId = this.haMessageId++;
    this.safeSend(ws, { id: this.haStateRequestId, type: 'get_states' });
  },

  subscribeToEntity: function (ws) {
    if (!this.haAuthenticated) return;
    const id = this.haMessageId++;
    this.haSubscriptionId = id;
    this.safeSend(ws, {
      id: id,
      type: 'subscribe_events',
      event_type: 'state_changed',
    });
  },

  scheduleReconnect: function (url, token, entityId) {
    if (this.haReconnectTimer) return;

    console.log('MMM-TextClockRH: Scheduling reconnect in 30 seconds...');
    this.haReconnectTimer = setTimeout(() => {
      this.haReconnectTimer = null;
      this.connectToHA(url, token, entityId);
    }, 30000);
  },
});
