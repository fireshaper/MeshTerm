/* MeshTerm concept kit: shared sample data, icons, terrain map, charts and small UI helpers.
   Every concept page loads this file and styles the output with its own --mt-* tokens. */
(function () {
  'use strict';
  const MK = (window.MK = {});

  /* ---------- deterministic randomness ---------- */
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  MK.rand = mulberry;

  MK.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- sample mesh (example data, not a real network) ---------- */
  MK.clock = '08:42';
  MK.connection = {
    state: 'connected', transport: 'TCP', host: '192.168.1.50', port: 4403, uptime: '3d 3h',
    lastPacketSec: 12, firmware: '2.5.20', region: 'US', preset: 'LongFast', freq: '906.875', modem: 'SF11 \u00b7 BW250 \u00b7 CR4/5',
  };
  MK.connections = [
    { id: 'base', name: 'MeshTerm Base', host: '192.168.1.50:4403', state: 'connected' },
    { id: 'cabin', name: 'Cabin Relay', host: 'cabin.lan:4403', state: 'reconnecting' },
  ];

  // x / y in km from my node; negative y is north.
  const N = (id, short, long, hw, role, o) => Object.assign({ id: '!' + id, short, long, hw, role }, o);
  MK.nodes = [
    N('a1b2c3d4', 'MTB', 'MeshTerm Base', 'Heltec V3', 'CLIENT', { me: true, hops: null, snr: null, rssi: null, heard: 0, batt: 87, volt: 4.05, x: 0, y: 0, util: 12.5, airtx: 3.2, uptime: '3d 3h', fav: false }),
    N('9e1f22a0', 'RDG', 'Ridge Repeater', 'RAK4631', 'ROUTER', { hops: 0, snr: 6.25, rssi: -88, heard: 1, batt: 100, volt: 4.18, solar: true, x: 3.2, y: -4.1, util: 14.1, airtx: 6.8, uptime: '41d', fav: true }),
    N('6b03c1d9', 'HIL', 'Hilltop Solar', 'RAK4631', 'ROUTER', { hops: 0, snr: -7.5, rssi: -112, heard: 12, batt: 18, volt: 3.52, solar: true, x: -5.6, y: -6.0, util: 11.8, airtx: 4.4, uptime: '12d', fav: true }),
    N('5e6f7081', 'GAR', 'Garage Station', 'Station G2', 'CLIENT_MUTE', { hops: 0, snr: 11.0, rssi: -42, heard: 2, batt: null, volt: null, x: 0.4, y: 0.6, util: 12.2, airtx: 0.4, uptime: '9d' }),
    N('c41a7e33', 'TRL', 'Trail Walker', 'T-Echo', 'CLIENT', { hops: 0, snr: -2.0, rssi: -101, heard: 8, batt: 64, volt: 3.86, x: 2.0, y: -2.2, util: 10.9, airtx: 1.1, uptime: '6h', fav: true }),
    N('21d4b8f6', 'KSTR', 'Kestrel Tower', 'Station G2', 'ROUTER', { hops: 1, snr: 3.5, rssi: -95, heard: 4, batt: null, volt: null, x: 8.5, y: -1.0, util: 14.0, airtx: 7.9, uptime: '47m' }),
    N('77a0e512', 'CAB', 'Cabin North', 'T-Beam', 'CLIENT', { hops: 1, snr: -4.25, rssi: -106, heard: 29, batt: 92, volt: 4.11, x: -2.5, y: -9.5, util: 9.4, airtx: 0.9, uptime: '2d' }),
    N('0d9c3b47', 'VAN', 'Ham Van', 'T-Beam', 'CLIENT', { hops: 1, snr: -6.0, rssi: -109, heard: 1, batt: 71, volt: 3.94, x: 6.8, y: 5.9, util: 8.8, airtx: 2.6, uptime: '1h' }),
    N('e2b97c08', 'ECHO', 'Echo Lake', 'Heltec V3', 'CLIENT', { hops: 0, snr: -3.25, rssi: -104, heard: 1, batt: 55, volt: 3.79, x: 7.4, y: 6.6, util: 9.1, airtx: 1.4, uptime: '5d' }),
    N('3c9e7a2b', '7a2b', 'Meshtastic 7a2b', 'T-Deck', 'CLIENT', { hops: 2, snr: -9.5, rssi: -114, heard: 30, batt: 100, volt: 4.2, x: -9.0, y: 3.5, util: 7.7, airtx: 0.6, uptime: '34m', isNew: true }),
    N('8a33f0c1', 'LIB', 'Library Roof', 'RAK4631', 'ROUTER', { hops: 0, snr: 4.0, rssi: -91, heard: 6, batt: null, volt: null, x: -3.1, y: 2.7, util: 13.3, airtx: 5.2, uptime: '18d' }),
    N('b5e01d6e', 'FIRE', 'Firewatch 3', 'RAK4631', 'ROUTER', { hops: 1, snr: -11.0, rssi: -117, heard: 362, batt: 41, volt: 3.71, solar: true, x: 1.5, y: -10.5, util: null, airtx: null, uptime: '?' }),
    N('f00d1e55', 'MOTO', 'Moto Tracker', 'T-Beam', 'TRACKER', { hops: 2, snr: -8.0, rssi: -113, heard: 95, batt: 77, volt: 3.98, x: -6.5, y: 8.0, util: 6.2, airtx: 0.8, uptime: '4h' }),
    N('1a2b9c4e', 'PINE', 'Pine Hollow', 'Heltec V3', 'CLIENT', { hops: 3, snr: -12.5, rssi: -118, heard: 780, batt: 33, volt: 3.66, x: -8.2, y: -2.0, util: null, airtx: null, uptime: '?' }),
  ];
  MK.nodes.forEach((n) => {
    n.dist = Math.hypot(n.x, n.y);
    n.bearing = (Math.atan2(n.x, -n.y) * 180) / Math.PI;
  });
  MK.me = MK.nodes[0];
  MK.byId = Object.fromEntries(MK.nodes.map((n) => [n.id, n]));
  MK.byShort = Object.fromEntries(MK.nodes.map((n) => [n.short, n]));
  MK.others = MK.nodes.filter((n) => !n.me);

  /* ---------- formatting ---------- */
  MK.ago = (min, long) => {
    if (min < 1) return long ? 'just now' : 'now';
    if (min < 60) return long ? `${Math.round(min)} min ago` : `${Math.round(min)}m`;
    if (min < 1440) return long ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 60)}h`;
    return long ? `${Math.round(min / 1440)} d ago` : `${Math.round(min / 1440)}d`;
  };
  MK.fresh = (min) => (min <= 15 ? 'live' : min <= 120 ? 'recent' : 'stale');
  MK.freshLabel = { live: 'Heard < 15 min', recent: 'Heard < 2 h', stale: 'Not heard 2 h+' };
  MK.snrQ = (snr) => (snr == null ? 'none' : snr >= 0 ? 'good' : snr >= -7 ? 'fair' : 'poor');
  MK.snrBars = (snr) => (snr == null ? 0 : snr >= 5 ? 4 : snr >= 0 ? 3 : snr >= -7 ? 2 : 1);
  MK.battQ = (b) => (b == null ? 'powered' : b >= 50 ? 'good' : b >= 25 ? 'fair' : 'poor');
  MK.km = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);
  MK.dB = (v) => { if (v == null) return '\u2014'; const a = Math.abs(v); const t = a % 1 ? a.toFixed(2).replace(/0$/, '') : a.toFixed(0); return `${v > 0 ? '+' : v < 0 ? '\u2212' : ''}${t} dB`; };
  MK.compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg + 360) % 360) / 45) % 8];
  MK.roleLabel = { CLIENT: 'Client', CLIENT_MUTE: 'Client mute', ROUTER: 'Router', TRACKER: 'Tracker', REPEATER: 'Repeater' };
  MK.hopsLabel = (h) => (h == null ? 'This node' : h === 0 ? 'Direct' : `${h} hop${h > 1 ? 's' : ''}`);
  MK.bytes = (s) => new TextEncoder().encode(s).length;

  /* ---------- traffic: 24 hourly buckets ending at 08:00 today ---------- */
  (function () {
    const r = mulberry(7);
    MK.traffic = [];
    for (let i = 0; i < 24; i++) {
      const hour = (9 + i) % 24;
      const f = hour >= 7 && hour <= 22 ? 0.35 + 0.65 * Math.sin(((hour - 7) / 15) * Math.PI) : 0.18;
      const b = {
        hour, label: String(hour).padStart(2, '0') + ':00',
        text: Math.round(f * 5 + r() * 3 * f),
        position: Math.round(5 + f * 9 + r() * 3),
        telemetry: Math.round(6 + r() * 4 + f * 3),
        nodeinfo: Math.round(1 + r() * 2),
        routing: Math.round(f * 4 + r() * 3),
        neighbor: Math.round(r() * 2),
        util: +(5 + f * 17 + r() * 4).toFixed(1),
      };
      if (hour === 14) { b.util = 31.2; b.position += 6; b.text += 3; }
      b.msgIn = b.text;
      b.msgOut = Math.round(b.text * 0.35 + (hour === 8 ? 2 : 0));
      b.packets = b.text + b.position + b.telemetry + b.nodeinfo + b.routing + b.neighbor;
      MK.traffic.push(b);
    }
    const sum = (k) => MK.traffic.reduce((s, b) => s + b[k], 0);
    MK.totals = { packets: sum('packets'), msgIn: sum('msgIn'), msgOut: sum('msgOut'), utilPeak: 31.2, utilPeakAt: '14:00' };
    MK.series = {
      online: [7, 7, 8, 8, 9, 9, 10, 9, 9, 8, 8, 7, 6, 6, 6, 6, 6, 7, 7, 8, 9, 9, 10, 10],
      battery: [96, 95, 95, 94, 93, 93, 92, 92, 91, 90, 89, 89, 88, 88, 87, 87, 86, 86, 86, 86, 87, 87, 87, 87],
      util: MK.traffic.map((b) => b.util),
      airtx: [2.1, 2.4, 2.8, 3.4, 3.9, 4.1, 3.8, 3.6, 3.2, 3.0, 2.6, 2.2, 1.9, 1.5, 1.4, 1.3, 1.2, 1.4, 1.8, 2.2, 2.6, 2.9, 3.1, 3.2],
      hilBatt: [44, 43, 42, 41, 40, 38, 36, 35, 33, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 19, 18],
    };
  })();
  MK.packetTypes = [
    { key: 'text', label: 'Text', port: 'TEXT_MESSAGE_APP' },
    { key: 'position', label: 'Position', port: 'POSITION_APP' },
    { key: 'telemetry', label: 'Telemetry', port: 'TELEMETRY_APP' },
    { key: 'nodeinfo', label: 'Node info', port: 'NODEINFO_APP' },
    { key: 'routing', label: 'Routing', port: 'ROUTING_APP' },
    { key: 'neighbor', label: 'Neighbor info', port: 'NEIGHBORINFO_APP' },
  ];

  /* ---------- attention + activity ---------- */
  MK.attention = [
    { sev: 'warn', node: '!6b03c1d9', title: 'Hilltop Solar battery at 18%', detail: 'Falling about 1% an hour since yesterday. It is a router, so the north ridge loses coverage when it dies.', metric: '3.52 V' },
    { sev: 'crit', node: '!b5e01d6e', title: 'Firewatch 3 silent for 6 h', detail: 'Last heard 02:40 at SNR \u221211 dB, battery 41%. Routers usually report every 15 min.', metric: '6 h' },
    { sev: 'info', node: null, title: 'Channel utilization peaked at 31%', detail: 'Yesterday 14:00. Above 25% the firmware delays position and telemetry broadcasts.', metric: '31.2%' },
  ];
  MK.events = [
    { t: '08:42', kind: 'message', node: '!e2b97c08', text: 'posted on #LongFast', sub: '\u201cLoud and clear, \u22123.2 dB direct.\u201d' },
    { t: '08:41', kind: 'heard', node: '!0d9c3b47', text: 'heard again after 9 h', sub: '6.8 km SE \u00b7 1 hop' },
    { t: '08:40', kind: 'sent', node: null, text: 'You posted on #LongFast', sub: 'Waiting for a relay to confirm' },
    { t: '08:30', kind: 'warn', node: '!6b03c1d9', text: 'battery 18%', sub: 'Dropped below 20%' },
    { t: '08:12', kind: 'new', node: '!3c9e7a2b', text: 'first seen', sub: 'T-Deck \u00b7 2 hops \u00b7 9.7 km W' },
    { t: '07:58', kind: 'heard', node: '!21d4b8f6', text: 'rebooted', sub: 'Firmware 2.5.20 \u00b7 uptime 47 m' },
    { t: '07:40', kind: 'link', node: null, text: 'Connection restored', sub: 'TCP 192.168.1.50 \u00b7 down 42 s' },
    { t: '06:10', kind: 'stale', node: '!b5e01d6e', text: 'not heard for 3 h', sub: 'Last SNR \u221211 dB' },
  ];

  /* ---------- conversations ---------- */
  MK.convs = [
    { id: 'ch0', kind: 'channel', index: 0, name: 'LongFast', role: 'Primary', enc: 'default', unread: 2 },
    { id: 'ch1', kind: 'channel', index: 1, name: 'Friends', role: 'Secondary', enc: 'psk', unread: 0 },
    { id: 'ch2', kind: 'channel', index: 2, name: 'RidgeOps', role: 'Secondary', enc: 'psk', unread: 1 },
    { id: 'dm-TRL', kind: 'dm', node: '!c41a7e33', pki: true, unread: 1 },
    { id: 'dm-CAB', kind: 'dm', node: '!77a0e512', pki: true, unread: 0 },
    { id: 'dm-VAN', kind: 'dm', node: '!0d9c3b47', pki: false, unread: 0 },
  ];
  const M = (from, t, text, o) => Object.assign({ from, t, text }, o);
  MK.msgs = {
    ch0: [
      M('!21d4b8f6', '07:58', 'Kestrel Tower is back after the firmware update. Shout if routing looks odd.', { snr: 3.5, hops: 1 }),
      M('!c41a7e33', '08:03', 'Morning! Anyone heading up the ridge trail today?', { snr: -2.0, hops: 0 }),
      M('me', '08:05', 'I\u2019ll be at the saddle around 10. Bringing the Heltec.', { status: 'acked' }),
      M('!77a0e512', '08:11', 'Snow line is down to about 1,800 m this morning. Road is clear to the trailhead.', { snr: -4.25, hops: 1 }),
      M('!3c9e7a2b', '08:20', 'test', { snr: -9.5, hops: 2 }),
      M('!5e6f7081', '08:21', 'Copy 7a2b, heard you at \u22129.5 dB via one hop.', { snr: 11.0, hops: 0, replyTo: 'test' }),
      M('!c41a7e33', '08:34', 'On my way now, should be at the saddle in about 30 minutes.', { snr: -2.0, hops: 0 }),
      M('me', '08:40', 'Copy. Ping me when you\u2019re there.', { status: 'sent' }),
      M('!0d9c3b47', '08:41', 'Range test from the van, parked at Echo Lake. Who hears me?', { snr: -6.0, hops: 1, unread: true }),
      M('!e2b97c08', '08:42', 'Loud and clear, \u22123.2 dB direct.', { snr: -3.25, hops: 0, unread: true }),
    ],
    ch1: [
      M('!77a0e512', 'Yesterday 19:20', 'Wood stove is going. Anyone want to come up Saturday?', { snr: -4.25, hops: 1 }),
      M('me', 'Yesterday 19:31', 'Count me in. I can bring the spare T-Beam for the shed.', { status: 'acked' }),
      M('!c41a7e33', 'Yesterday 20:02', 'Same. I\u2019ll pick up the solar panel for Hilltop on the way.', { snr: -2.0, hops: 0 }),
    ],
    ch2: [
      M('!9e1f22a0', '06:00', 'RDG daily check: battery 100%, panel 5.9 V, uptime 41 d.', { snr: 6.25, hops: 0 }),
      M('!6b03c1d9', '06:00', 'HIL daily check: battery 31%, panel 0.4 V, uptime 12 d.', { snr: -7.5, hops: 0 }),
      M('!c41a7e33', '08:15', 'HIL panel is probably iced over. Will look Saturday.', { snr: -2.0, hops: 0, unread: true }),
    ],
    'dm-TRL': [
      M('!c41a7e33', '07:12', 'Can you check if Hilltop Solar is reporting? Mine shows 18%.', { snr: -2.0, hops: 0 }),
      M('me', '07:15', 'It is, 3.52 V and dropping since the cloud came in.', { status: 'acked' }),
      M('!c41a7e33', '07:16', 'Ok. I\u2019ll swap the panel Saturday.', { snr: -2.0, hops: 0 }),
      M('me', '07:17', 'Thanks, I\u2019ll keep an eye on it.', { status: 'acked' }),
      M('!c41a7e33', '08:36', 'Passing the old quarry, signal is better than last week.', { snr: -2.0, hops: 0, unread: true }),
    ],
    'dm-CAB': [
      M('me', 'Yesterday 17:02', 'Is the cabin node on the new firmware yet?', { status: 'acked' }),
      M('!77a0e512', 'Yesterday 17:40', 'Yes, 2.5.20 since Tuesday.', { snr: -4.25, hops: 1 }),
    ],
    'dm-VAN': [
      M('!0d9c3b47', 'Yesterday 23:10', 'Heading out to the lake in the morning.', { snr: -6.0, hops: 1 }),
      M('me', 'Yesterday 23:12', 'Good luck with the range test.', { status: 'failed' }),
    ],
  };
  MK.convTitle = (c) => (c.kind === 'channel' ? c.name : MK.byId[c.node].long);
  MK.convLast = (c) => MK.msgs[c.id][MK.msgs[c.id].length - 1];
  MK.sender = (m) => (m.from === 'me' ? MK.me : MK.byId[m.from]);
  MK.statusLabel = { queued: 'Queued', sent: 'Sent, waiting for ACK', acked: 'Delivered', failed: 'Not delivered' };

  MK.send = function (convId, text, onUpdate) {
    const m = { from: 'me', t: MK.clock, text, status: 'queued', fresh: true };
    MK.msgs[convId].push(m);
    onUpdate(m);
    setTimeout(() => { m.status = 'sent'; onUpdate(m); }, 700);
    setTimeout(() => { m.status = 'acked'; onUpdate(m); }, 2600);
    return m;
  };

  /* ---------- icons (Lucide-style strokes, currentColor) ---------- */
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    messages: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    map: '<path d="M14.1 6.3 9 3.8a2 2 0 0 0-1.8 0L3.6 5.6A1 1 0 0 0 3 6.5v13a1 1 0 0 0 1.4.9l3.8-1.9a2 2 0 0 1 1.8 0l5.1 2.5a2 2 0 0 0 1.8 0l3.6-1.8a1 1 0 0 0 .6-.9v-13a1 1 0 0 0-1.4-.9l-3.8 1.9a2 2 0 0 1-1.8 0z"/><path d="M15 6.5v14.5M9 3.5V18"/>',
    nodes: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    telemetry: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
    signal: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checks: '<path d="M17 6 6.5 16.5 2 12"/><path d="m22 10-6.5 6.5-1.5-1.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 15h3M2 9h3M2 15h3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15.7-6L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.7 6L3 16"/><path d="M8 16H3v5"/>',
    filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    up: '<path d="M7 17 17 7M7 7h10v10"/>',
    trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    hop: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12c2-5 8-5 10 0"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/>',
    logo: '<circle cx="12" cy="5" r="2.4"/><circle cx="4.5" cy="18" r="2.4"/><circle cx="19.5" cy="18" r="2.4"/><path d="M10.8 7.1 5.7 15.9M13.2 7.1l5.1 8.8M6.9 18h10.2"/>',
  };
  MK.icon = (name, size = 18, extra = '') =>
    `<svg class="i i-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;

  /* ---------- theme + accent ---------- */
  const root = document.documentElement;
  MK.cssVar = (name, el = root) => getComputedStyle(el).getPropertyValue(name).trim();
  MK.effectiveTheme = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const fireTheme = () => document.dispatchEvent(new CustomEvent('mk-theme'));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', fireTheme);
  MK.themeToggle = function (btn) {
    const paint = () => {
      const t = MK.effectiveTheme();
      btn.innerHTML = MK.icon(t === 'dark' ? 'sun' : 'moon', 18);
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = btn.getAttribute('aria-label');
    };
    btn.addEventListener('click', () => {
      root.dataset.theme = MK.effectiveTheme() === 'dark' ? 'light' : 'dark';
      paint(); fireTheme();
    });
    document.addEventListener('mk-theme', paint);
    paint();
  };
  MK.accentPicker = function (container, list, storeKey) {
    let current = list[0].id;
    try { const s = localStorage.getItem(storeKey); if (s && list.some((a) => a.id === s)) current = s; } catch (e) { /* storage blocked */ }
    const apply = (id) => {
      current = id; root.dataset.accent = id;
      container.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
      try { localStorage.setItem(storeKey, id); } catch (e) { /* storage blocked */ }
      fireTheme();
    };
    container.innerHTML = list.map((a) => `<button type="button" class="swatch" data-id="${a.id}" aria-label="${a.label} accent" title="${a.label}"><span></span></button>`).join('');
    container.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) apply(b.dataset.id); });
    apply(current);
  };

  /* ---------- views ---------- */
  MK.router = function (views, onChange) {
    const show = (name, push) => {
      if (!views.includes(name)) name = views[0];
      document.querySelectorAll('[data-view-panel]').forEach((p) => { p.hidden = p.dataset.viewPanel !== name; });
      document.querySelectorAll('[data-view]').forEach((a) => {
        if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      document.documentElement.dataset.view = name;
      if (push) try { history.replaceState(null, '', '#' + name); } catch (e) { /* sandboxed */ }
      onChange && onChange(name);
    };
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-view]:not(html)');
      if (!a) return;
      e.preventDefault();
      show(a.dataset.view, true);
    });
    window.addEventListener('hashchange', () => show((location.hash || '').slice(1), false));
    show((location.hash || '').slice(1), false);
    return show;
  };
  MK.toast = function (text) {
    let host = document.querySelector('.mk-toasts');
    if (!host) { host = document.createElement('div'); host.className = 'mk-toasts'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'mk-toast'; t.textContent = text;
    host.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  };
  MK.notMocked = (what) => MK.toast(`${what} isn\u2019t part of this concept mock.`);

  /* ---------- small charts ---------- */
  MK.spark = function (vals, o = {}) {
    const w = o.w || 120, h = o.h || 32, pad = 3;
    const min = o.min ?? Math.min(...vals), max = o.max ?? Math.max(...vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (w - pad * 2), pad + (1 - (v - min) / span) * (h - pad * 2)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const area = `${line}L${pts[pts.length - 1][0].toFixed(1)} ${h}L${pts[0][0].toFixed(1)} ${h}Z`;
    const last = pts[pts.length - 1];
    return `<svg class="spark ${o.cls || ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${o.area === false ? '' : `<path class="spark-area" d="${area}"/>`}<path class="spark-line" d="${line}"/><circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6"/></svg>`;
  };
  MK.bars = function (n, level, cls = '') {
    let s = `<span class="sigbars ${cls}" data-level="${level}" aria-hidden="true">`;
    for (let i = 1; i <= n; i++) s += `<i class="${i <= level ? 'on' : ''}"></i>`;
    return s + '</span>';
  };
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x * p >= v);
    return m * p;
  }
  MK.niceMax = niceMax;

  MK.stackChart = function (el, o) {
    o = Object.assign({ height: 220, mode: 'bars', pad: { l: 34, r: 44, t: 14, b: 26 }, gap: 0.3, xEvery: 6, radius: 1.5, label: 'Chart' }, o);
    el.classList.add('mk-chart');
    const tip = document.createElement('div');
    tip.className = 'mk-tip'; tip.hidden = true;
    let geo = null;
    function render() {
      const W = Math.floor(el.clientWidth);
      if (!W) return;
      const H = o.height, p = o.pad, iw = W - p.l - p.r, ih = H - p.t - p.b, n = o.data.length;
      const totals = o.data.map((d) => o.keys.reduce((s, k) => s + d[k.key], 0));
      const maxV = niceMax(Math.max(...totals));
      const bw = iw / n;
      geo = { W, H, p, iw, ih, bw };
      const y = (v) => p.t + ih - (v / maxV) * ih;
      let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${MK.esc(o.label)}">`;
      [0, maxV / 2, maxV].forEach((t) => {
        s += `<line class="mk-gridline" x1="${p.l}" x2="${W - p.r}" y1="${y(t)}" y2="${y(t)}"/><text class="mk-axis" x="${p.l - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`;
      });
      s += `<rect class="mk-hover" x="0" y="${p.t}" width="${bw}" height="${ih}" opacity="0"/>`;
      if (o.mode === 'bars') {
        o.data.forEach((d, i) => {
          let acc = 0;
          const x = p.l + i * bw + (bw * o.gap) / 2, w = bw * (1 - o.gap);
          o.keys.forEach((k) => {
            const v = d[k.key];
            if (!v) return;
            const y1 = y(acc + v), y0 = y(acc);
            acc += v;
            s += `<rect class="mk-s ${k.cls}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(y0 - y1 - 1, 0.6).toFixed(1)}" rx="${o.radius}"/>`;
          });
        });
      } else {
        const cum = o.data.map(() => 0);
        o.keys.forEach((k) => {
          const top = [], bot = [];
          o.data.forEach((d, i) => {
            const x = p.l + i * bw + bw / 2;
            bot.push([x, y(cum[i])]);
            cum[i] += d[k.key];
            top.push([x, y(cum[i])]);
          });
          const path = top.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('') + bot.reverse().map((q) => 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('') + 'Z';
          s += `<path class="mk-s mk-area ${k.cls}" d="${path}"/>`;
          s += `<path class="mk-s-edge ${k.cls}" d="${top.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('')}"/>`;
        });
      }
      if (o.line) {
        const L = o.line, lmax = L.max;
        const ly = (v) => p.t + ih - (v / lmax) * ih;
        const pts = o.data.map((d, i) => [p.l + i * bw + bw / 2, ly(d[L.key])]);
        if (L.threshold != null) {
          s += `<line class="mk-threshold" x1="${p.l}" x2="${W - p.r}" y1="${ly(L.threshold)}" y2="${ly(L.threshold)}"/>`;
          s += `<text class="mk-axis mk-threshold-label" x="${W - p.r + 6}" y="${ly(L.threshold) + 4}">${L.threshold}%</text>`;
        }
        s += `<text class="mk-axis" x="${W - p.r + 6}" y="${ly(lmax) + 4}">${lmax}%</text><text class="mk-axis" x="${W - p.r + 6}" y="${ly(0) + 4}">0%</text>`;
        s += `<path class="mk-line ${L.cls || ''}" d="${pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('')}"/>`;
        const peak = o.data.reduce((bi, d, i) => (d[L.key] > o.data[bi][L.key] ? i : bi), 0);
        s += `<circle class="mk-line-dot ${L.cls || ''}" cx="${pts[peak][0]}" cy="${pts[peak][1]}" r="3.5"/>`;
      }
      o.data.forEach((d, i) => {
        if (i % o.xEvery === 0 || i === n - 1) s += `<text class="mk-axis" x="${p.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${o.xLabel ? o.xLabel(d, i) : d.label}</text>`;
      });
      s += '</svg>';
      el.innerHTML = s;
      el.appendChild(tip);
    }
    el.addEventListener('pointermove', (e) => {
      if (!geo) return;
      const r = el.getBoundingClientRect();
      const i = Math.floor((e.clientX - r.left - geo.p.l) / geo.bw);
      const hov = el.querySelector('.mk-hover');
      if (i < 0 || i >= o.data.length) { tip.hidden = true; hov && hov.setAttribute('opacity', '0'); return; }
      const d = o.data[i];
      hov.setAttribute('x', geo.p.l + i * geo.bw); hov.setAttribute('opacity', '1');
      tip.innerHTML = `<b>${d.label}</b>` + o.keys.map((k) => `<span><i class="sw ${k.cls}"></i>${k.label}<em>${d[k.key]}</em></span>`).join('') + (o.line ? `<span><i class="sw ${o.line.cls || 'mk-line'}"></i>${o.line.label}<em>${d[o.line.key]}%</em></span>` : '');
      tip.hidden = false;
      const x = geo.p.l + i * geo.bw + geo.bw / 2;
      tip.style.left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), geo.W - tip.offsetWidth) + 'px';
    });
    el.addEventListener('pointerleave', () => { tip.hidden = true; const hov = el.querySelector('.mk-hover'); hov && hov.setAttribute('opacity', '0'); });
    new ResizeObserver(render).observe(el);
    document.addEventListener('mk-theme', render);
    render();
  };

  /* ---------- terrain ---------- */
  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  const g = (x, y, cx, cy, s) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s);
  MK.height = function (x, y) {
    let h = 0, amp = 1, f = 0.16;
    for (let o = 0; o < 4; o++) { h += amp * vnoise(x * f + 31.7, y * f - 12.3, 11 + o); amp *= 0.5; f *= 2.05; }
    const d = x * 0.42 + y * 0.9 + 6.2;
    h += 1.0 * Math.exp((-d * d) / 9);
    h += 0.75 * g(x, y, 3.2, -4.1, 3) + 0.85 * g(x, y, -5.6, -6, 2.6) + 0.6 * g(x, y, 1.5, -10.5, 4);
    h -= 1.4 * g(x, y, 8.9, 7.8, 2.6);
    return h;
  };
  const LAKE = { x: 8.9, y: 7.8 };
  MK.lakeLevel = MK.height(LAKE.x, LAKE.y) + 0.5;
  MK.lake = LAKE;

  const rgbCache = {};
  MK.rgb = function (css) {
    if (rgbCache[css]) return rgbCache[css];
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillStyle = css; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return (rgbCache[css] = [d[0], d[1], d[2], d[3] / 255]);
  };

  MK.Map = class {
    constructor(el, o) {
      this.el = el;
      this.o = Object.assign({
        pad: 40, zoom: 1, cx: -0.5, cy: -1.5, links: true, linkLabels: false, rings: [], grid: 0, gridLabels: false,
        interval: 0.11, majorEvery: 5, step: 4, shade: false, water: true, interactive: true, scale: true,
        marker: null, onSelect: null, nodes: MK.nodes, span: 22,
      }, o);
      this.zoom = this.o.zoom; this.cx = this.o.cx; this.cy = this.o.cy; this.sel = null;
      el.classList.add('mk-map');
      el.insertAdjacentHTML('afterbegin', '<canvas class="mk-map-canvas" aria-hidden="true"></canvas><svg class="mk-map-svg" aria-hidden="true"></svg><div class="mk-map-markers"></div>' + (this.o.scale ? '<div class="mk-scale" aria-hidden="true"><i></i><span></span></div>' : ''));
      this.canvas = el.querySelector('.mk-map-canvas');
      this.svg = el.querySelector('.mk-map-svg');
      this.mk = el.querySelector('.mk-map-markers');
      this.mk.innerHTML = this.o.nodes.map((n) => {
        const inner = this.o.marker ? this.o.marker(n) : `<span class="mk-dot"></span><span class="mk-label">${MK.esc(n.short)}</span>`;
        return `<button type="button" class="mk-marker" data-id="${n.id}" data-fresh="${MK.fresh(n.heard)}" data-role="${n.role}" data-snr="${MK.snrQ(n.snr)}" ${n.me ? 'data-me="true"' : ''} aria-label="${MK.esc(n.long)}, ${MK.hopsLabel(n.hops)}, heard ${MK.ago(n.heard, true)}">${inner}</button>`;
      }).join('');
      this.mk.addEventListener('click', (e) => { const b = e.target.closest('.mk-marker'); if (b) this.select(b.dataset.id, true); });
      new ResizeObserver(() => this.schedule()).observe(el);
      document.addEventListener('mk-theme', () => this.schedule());
      if (this.o.interactive) this.bindPan();
    }
    schedule(fast) { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.render(fast)); }
    bindPan() {
      let st = null;
      this.el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.mk-marker, .mk-ui, button, a, input, select')) return;
        st = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, id: e.pointerId };
        this.el.setPointerCapture(e.pointerId); this.el.classList.add('dragging');
      });
      this.el.addEventListener('pointermove', (e) => {
        if (!st) return;
        this.cx = st.cx - (e.clientX - st.x) / this.s; this.cy = st.cy - (e.clientY - st.y) / this.s;
        this.schedule(true);
      });
      const end = () => { if (!st) return; st = null; this.el.classList.remove('dragging'); this.schedule(); };
      this.el.addEventListener('pointerup', end); this.el.addEventListener('pointercancel', end);
      this.el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    }
    zoomBy(f) { this.zoom = Math.min(4, Math.max(0.55, this.zoom * f)); this.schedule(); }
    reset() { this.zoom = this.o.zoom; this.cx = this.o.cx; this.cy = this.o.cy; this.schedule(); }
    focus(id) { const n = MK.byId[id]; if (!n) return; this.cx = n.x; this.cy = n.y; this.zoom = Math.max(this.zoom, 1.6); this.schedule(); }
    select(id, user) {
      this.sel = id;
      this.mk.querySelectorAll('.mk-marker').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
      this.drawSvg();
      if (user && this.o.onSelect) this.o.onSelect(MK.byId[id]);
    }
    toPx(x, y) { return [this.w / 2 + (x - this.cx) * this.s, this.h / 2 + (y - this.cy) * this.s]; }
    render(fast) {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h) return;
      this.w = w; this.h = h;
      this.s = (Math.min(w - this.o.pad * 2, h - this.o.pad * 2) / this.o.span) * this.zoom;
      this.drawTerrain(fast);
      this.drawSvg();
      this.mk.querySelectorAll('.mk-marker').forEach((b) => {
        const n = MK.byId[b.dataset.id];
        const [px, py] = this.toPx(n.x, n.y);
        b.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      });
      if (this.o.scale) {
        const kmpx = 1 / this.s;
        const nice = [0.25, 0.5, 1, 2, 5, 10, 20].find((k) => k / kmpx >= 56) || 20;
        const sc = this.el.querySelector('.mk-scale');
        sc.querySelector('i').style.width = (nice / kmpx).toFixed(0) + 'px';
        sc.querySelector('span').textContent = nice < 1 ? nice * 1000 + ' m' : nice + ' km';
      }
    }
    drawTerrain(fast) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = this.canvas, w = this.w, h = this.h;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = (n) => MK.cssVar(n, this.el);
      ctx.fillStyle = v('--mt-map-land'); ctx.fillRect(0, 0, w, h);
      const step = fast ? this.o.step + 2 : this.o.step;
      const cols = Math.ceil(w / step) + 2, rows = Math.ceil(h / step) + 2;
      const grid = new Float32Array(cols * rows);
      const wx0 = this.cx - w / 2 / this.s, wy0 = this.cy - h / 2 / this.s, ws = step / this.s;
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const val = MK.height(wx0 + i * ws, wy0 + j * ws);
        grid[j * cols + i] = val; if (val < lo) lo = val; if (val > hi) hi = val;
      }
      // hillshade + water, painted at grid resolution and scaled up smoothly
      const off = document.createElement('canvas'); off.width = cols; off.height = rows;
      const ox = off.getContext('2d'); const img = ox.createImageData(cols, rows);
      const shadeOn = this.o.shade, waterOn = this.o.water;
      const sd = shadeOn ? MK.rgb(v('--mt-map-shade')) : null, hl = shadeOn ? MK.rgb(v('--mt-map-highlight')) : null, wc = waterOn ? MK.rgb(v('--mt-map-water')) : null;
      const k = 0.9 / (2 * ws);
      for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
        const idx = j * cols + i, p4 = idx * 4, val = grid[idx];
        const wxp = wx0 + i * ws, wyp = wy0 + j * ws;
        if (waterOn && val < MK.lakeLevel && Math.hypot(wxp - LAKE.x, wyp - LAKE.y) < 4) {
          img.data[p4] = wc[0]; img.data[p4 + 1] = wc[1]; img.data[p4 + 2] = wc[2]; img.data[p4 + 3] = 255 * wc[3];
          continue;
        }
        if (shadeOn) {
          const sl = ((grid[idx - 1] - grid[idx + 1]) + (grid[idx - cols] - grid[idx + cols])) * k;
          const col = sl < 0 ? sd : hl, a = Math.min(Math.abs(sl), 1) * col[3];
          img.data[p4] = col[0]; img.data[p4 + 1] = col[1]; img.data[p4 + 2] = col[2]; img.data[p4 + 3] = 255 * a;
        }
      }
      ox.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, cols * step, rows * step);
      // contours (marching squares)
      const minor = v('--mt-map-contour'), major = v('--mt-map-contour-major');
      const iv = this.o.interval;
      const start = Math.ceil(lo / iv) * iv;
      for (let L = start, li = Math.round(start / iv); L < hi; L += iv, li++) {
        const isMajor = li % this.o.majorEvery === 0;
        ctx.beginPath();
        for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
          const a = grid[j * cols + i], b = grid[j * cols + i + 1], cc = grid[(j + 1) * cols + i + 1], d = grid[(j + 1) * cols + i];
          const id = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0);
          if (id === 0 || id === 15) continue;
          const x = i * step, y = j * step;
          const T = () => [x + (step * (L - a)) / (b - a), y], R = () => [x + step, y + (step * (L - b)) / (cc - b)];
          const B = () => [x + (step * (L - d)) / (cc - d), y + step], Lf = () => [x, y + (step * (L - a)) / (d - a)];
          const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
          switch (id) {
            case 1: case 14: seg(Lf(), B()); break;
            case 2: case 13: seg(B(), R()); break;
            case 3: case 12: seg(Lf(), R()); break;
            case 4: case 11: seg(T(), R()); break;
            case 5: seg(Lf(), B()); seg(T(), R()); break;
            case 6: case 9: seg(T(), B()); break;
            case 7: case 8: seg(Lf(), T()); break;
            case 10: seg(Lf(), T()); seg(B(), R()); break;
          }
        }
        ctx.strokeStyle = isMajor ? major : minor;
        ctx.lineWidth = isMajor ? 1.1 : 0.7;
        ctx.stroke();
      }
    }
    drawSvg() {
      if (!this.w) return;
      const w = this.w, h = this.h;
      let s = '';
      if (this.o.grid) {
        const gkm = this.o.grid;
        const x0 = this.cx - w / 2 / this.s, x1 = this.cx + w / 2 / this.s, y0 = this.cy - h / 2 / this.s, y1 = this.cy + h / 2 / this.s;
        for (let gx = Math.ceil(x0 / gkm) * gkm; gx <= x1; gx += gkm) {
          const px = this.toPx(gx, 0)[0];
          s += `<line class="mk-grid" x1="${px}" x2="${px}" y1="0" y2="${h}"/>`;
          if (this.o.gridLabels) s += `<text class="mk-grid-label" x="${px + 4}" y="14">${String.fromCharCode(65 + Math.max(0, Math.min(25, Math.round(gx / gkm) + 9)))}</text>`;
        }
        for (let gy = Math.ceil(y0 / gkm) * gkm; gy <= y1; gy += gkm) {
          const py = this.toPx(0, gy)[1];
          s += `<line class="mk-grid" x1="0" x2="${w}" y1="${py}" y2="${py}"/>`;
          if (this.o.gridLabels) s += `<text class="mk-grid-label" x="4" y="${py - 4}">${50 + Math.round(gy / gkm)}</text>`;
        }
      }
      const [mx, my] = this.toPx(0, 0);
      this.o.rings.forEach((r) => {
        s += `<circle class="mk-ring" cx="${mx}" cy="${my}" r="${r * this.s}"/><text class="mk-ring-label" x="${mx + r * this.s * 0.71 + 4}" y="${my - r * this.s * 0.71}">${r} km</text>`;
      });
      if (this.o.links) {
        this.o.nodes.filter((n) => n.hops === 0).forEach((n) => {
          const [px, py] = this.toPx(n.x, n.y);
          const sel = this.sel === n.id ? ' sel' : '';
          s += `<line class="mk-link mk-link-${MK.snrQ(n.snr)}${sel}" x1="${mx}" y1="${my}" x2="${px}" y2="${py}"/>`;
          if (this.o.linkLabels) s += `<text class="mk-link-label" x="${(mx + px) / 2}" y="${(my + py) / 2 - 5}" text-anchor="middle">${MK.dB(n.snr)}</text>`;
        });
      }
      this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this.svg.innerHTML = s;
    }
  };

  /* ---------- shared base CSS for kit-generated parts (themed by each page's tokens) ---------- */
  const css = `
  .mk-map{position:relative;overflow:hidden;touch-action:none;cursor:grab;user-select:none}
  .mk-map.dragging{cursor:grabbing}
  .mk-map-canvas,.mk-map-svg{position:absolute;inset:0;width:100%;height:100%}
  .mk-map-markers{position:absolute;inset:0;pointer-events:none}
  .mk-marker{position:absolute;left:0;top:0;pointer-events:auto;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;will-change:transform}
  .mk-scale{position:absolute;display:flex;flex-direction:column;gap:3px;pointer-events:none}
  .mk-scale i{display:block;height:6px;border:1.5px solid currentColor;border-top:0}
  .mk-chart{position:relative}
  .mk-chart svg{display:block}
  .mk-tip{position:absolute;top:0;pointer-events:none;z-index:5;display:grid;gap:2px;white-space:nowrap}
  .mk-tip span{display:flex;align-items:center;gap:6px}
  .mk-tip em{font-style:normal;margin-left:auto;padding-left:14px;font-variant-numeric:tabular-nums}
  .mk-tip .sw{width:8px;height:8px;border-radius:2px;display:inline-block}
  .sigbars{display:inline-flex;align-items:flex-end;gap:2px;height:12px}
  .sigbars i{display:block;width:3px;border-radius:1px}
  .sigbars i:nth-child(1){height:30%}.sigbars i:nth-child(2){height:55%}.sigbars i:nth-child(3){height:80%}.sigbars i:nth-child(4){height:100%}
  .mk-toasts{position:fixed;z-index:100;left:50%;transform:translateX(-50%);bottom:calc(24px + env(safe-area-inset-bottom,0px));display:grid;gap:8px;pointer-events:none}
  .mk-toast{transition:opacity .3s,transform .3s}
  .mk-toast.out{opacity:0;transform:translateY(6px)}
  @media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.prepend(st);
})();
