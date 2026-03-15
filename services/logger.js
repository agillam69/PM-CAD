const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for detailed logging
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message} ${metaStr}`;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Daily rotate file transport for all logs
const fileRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'cad-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat
});

// Daily rotate file transport for errors only
const errorRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: logFormat
});

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    }),
    fileRotateTransport,
    errorRotateTransport
  ]
});

// Helper methods for structured logging
logger.logMessage = function(action, data) {
  this.info(`[MESSAGE] ${action}`, data);
};

logger.logCase = function(action, caseNumber, data = {}) {
  this.info(`[CASE] ${action}: ${caseNumber}`, data);
};

logger.logIngest = function(action, data) {
  this.info(`[INGEST] ${action}`, data);
};

logger.logSync = function(action, data) {
  this.info(`[SYNC] ${action}`, data);
};

logger.logApi = function(method, path, status, data = {}) {
  this.info(`[API] ${method} ${path} - ${status}`, data);
};

logger.logFilter = function(reason, pattern, data = {}) {
  this.debug(`[FILTER] ${reason}`, { pattern, ...data });
};

logger.logPriority = function(caseNumber, reason, data = {}) {
  this.info(`[PRIORITY] Case ${caseNumber} flagged: ${reason}`, data);
};

// Get list of log files
logger.getLogFiles = function() {
  try {
    const files = fs.readdirSync(logsDir);
    return files
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const stats = fs.statSync(path.join(logsDir, f));
        return {
          name: f,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          modified: stats.mtime,
          path: path.join(logsDir, f)
        };
      })
      .sort((a, b) => b.modified - a.modified);
  } catch (e) {
    return [];
  }
};

// Get log file content
logger.getLogContent = function(filename, lines = 500) {
  const filePath = path.join(logsDir, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n');
    // Return last N lines
    return allLines.slice(-lines).join('\n');
  } catch (e) {
    return null;
  }
};

// Get full log file path for download
logger.getLogPath = function(filename) {
  // Sanitize filename to prevent directory traversal
  const sanitized = path.basename(filename);
  const filePath = path.join(logsDir, sanitized);
  
  if (fs.existsSync(filePath) && filePath.startsWith(logsDir)) {
    return filePath;
  }
  return null;
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = logger;
