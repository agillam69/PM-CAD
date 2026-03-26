const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');
const fs = require('fs');
const { Server } = require('socket.io');

// Config setup
const confFile = path.join(__dirname, 'config', 'config.json');
const confDefaults = require('./config/default.json');

if (!fs.existsSync(confFile)) {
  fs.writeFileSync(confFile, JSON.stringify(confDefaults, null, 2));
  console.log('Created config file:', confFile);
}

const nconf = require('nconf');
nconf.file({ file: confFile });
nconf.load();

// Initialize Express first (db.init is async, called later)
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Make io available to routes
app.set('io', io);

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Make nconf available to routes
app.use((req, res, next) => {
  req.nconf = nconf;
  next();
});

// Routes
const cadRoutes = require('./routes/cad');
const mapRoutes = require('./routes/map');
const ingestRoutes = require('./routes/ingest');
const settingsRoutes = require('./routes/settings');

app.use('/cad', cadRoutes);
app.use('/map', mapRoutes);
app.use('/ingest', ingestRoutes);
app.use('/settings', settingsRoutes);

// Home redirect
app.get('/', (req, res) => {
  res.redirect('/cad');
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('CAD client connected:', socket.id);
  
  socket.on('join', (room) => {
    socket.join(room);
    console.log(`Client ${socket.id} joined room: ${room}`);
  });
  
  socket.on('disconnect', () => {
    console.log('CAD client disconnected:', socket.id);
  });
});

// Mode detection
const mode = nconf.get('mode') || 'standalone';
console.log(`Running in ${mode.toUpperCase()} mode`);

// Initialize PagerMon socket connection (only in connected mode)
const pagermonSocket = require('./services/pagermonSocket');
const caseManager = require('./services/caseManager');

if (mode === 'connected') {
  // Connected mode: Direct connection to PagerMon
  pagermonSocket.init(io);
  
  setTimeout(async () => {
    console.log('Initial sync from PagerMon database...');
    try {
      await caseManager.syncFromPagermon();
    } catch (error) {
      console.error('Initial sync failed:', error.message);
    }
  }, 3000);
} else {
  // Standalone mode: Receives messages via /ingest endpoint
  console.log('Standalone mode - waiting for messages via /ingest/message endpoint');
  console.log('Configure PagerMon Message Repeat plugin to send to: http://YOUR_SERVER:3001/ingest/message');
}

// Periodic cleanup - runs every 5 minutes to close old cases based on timeout settings
setInterval(() => {
  caseManager.closeOldCases();
}, 5 * 60 * 1000);

// Run once on startup after a short delay
setTimeout(() => {
  caseManager.closeOldCases();
}, 10000);

// Error handling
app.use((req, res, next) => {
  res.status(404).render('cad/error', {
    pageTitle: 'Not Found',
    message: 'Page not found'
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('cad/error', {
    pageTitle: 'Error',
    message: 'Internal server error'
  });
});

// Start server with async initialization
const port = nconf.get('server:port') || 3001;

async function startServer() {
  // Initialize database (async for sql.js)
  const db = require('./db');
  await db.init();
  
  // Fix existing cases that may have incorrect service detection
  console.log('Checking for cases that need service/prefix fixes...');
  db.fixCaseServiceFromPrefix();
  
  server.listen(port, () => {
    console.log('='.repeat(50));
    console.log('PagerMon CAD Add-on');
    console.log('='.repeat(50));
    console.log(`Server running on http://localhost:${port}`);
    console.log(`CAD Board: http://localhost:${port}/cad`);
    console.log(`Live Map:  http://localhost:${port}/map`);
    console.log('='.repeat(50));
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
