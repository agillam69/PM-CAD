const { io } = require('socket.io-client');
const nconf = require('nconf');
const caseManager = require('./caseManager');

let socket = null;
let cadIo = null; // Our own socket.io server to broadcast to CAD clients

function init(ioServer) {
  cadIo = ioServer;
  
  const pagermonUrl = nconf.get('pagermon:url') || 'http://localhost:3000';
  
  console.log(`Connecting to PagerMon WebSocket at ${pagermonUrl}`);
  
  socket = io(pagermonUrl, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });
  
  socket.on('connect', () => {
    console.log('Connected to PagerMon WebSocket');
  });
  
  socket.on('disconnect', (reason) => {
    console.log('Disconnected from PagerMon:', reason);
  });
  
  socket.on('connect_error', (error) => {
    console.error('PagerMon connection error:', error.message);
  });
  
  socket.on('messagePost', async (msg) => {
    console.log('Received message from PagerMon:', msg.id);
    
    try {
      const result = await caseManager.processMessage(msg);
      
      if (result && result.case) {
        // Broadcast to CAD clients
        const caseDetails = caseManager.getCaseWithDetails(result.case.case_number);
        
        if (cadIo) {
          cadIo.emit('caseUpdate', {
            type: 'update',
            case: caseDetails
          });
          
          // Also emit to service-specific rooms
          if (caseDetails.service) {
            cadIo.to(caseDetails.service).emit('caseUpdate', {
              type: 'update',
              case: caseDetails
            });
          }
        }
        
        console.log(`Processed case ${result.case.case_number} (${result.parsed.service})`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  return socket;
}

function getSocket() {
  return socket;
}

function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

module.exports = {
  init,
  getSocket,
  disconnect
};
