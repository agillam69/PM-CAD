const PDFDocument = require('pdfkit');
const moment = require('moment');
const db = require('../db');

// Generate dispatch slip PDF (quick grab-and-go for crews)
function generateDispatchSlip(caseData, messageText) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A5',
        margin: 30
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Header
      doc.fontSize(16).font('Helvetica-Bold');
      doc.text('DISPATCH', { align: 'center' });
      doc.moveDown(0.5);
      
      // Case number and service
      doc.fontSize(20).font('Helvetica-Bold');
      doc.text(caseData.case_number, { align: 'center' });
      doc.moveDown(0.3);
      
      // Service badge
      doc.fontSize(12).font('Helvetica');
      const serviceText = caseData.service ? caseData.service.toUpperCase() : 'UNKNOWN';
      doc.text(serviceText, { align: 'center' });
      doc.moveDown(1);
      
      // Timestamp
      doc.fontSize(10).font('Helvetica');
      doc.text(moment().format('DD/MM/YYYY HH:mm:ss'), { align: 'center' });
      doc.moveDown(1);
      
      // Divider
      doc.moveTo(30, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
      doc.moveDown(1);
      
      // Full pager message (centered, larger font)
      doc.fontSize(11).font('Courier');
      if (messageText) {
        doc.text(messageText, {
          align: 'center',
          width: doc.page.width - 60
        });
      }
      doc.moveDown(1);
      
      // Divider
      doc.moveTo(30, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
      doc.moveDown(1);
      
      // Address (prominent)
      if (caseData.address) {
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text('ADDRESS:', { align: 'left' });
        doc.fontSize(16).font('Helvetica');
        doc.text(caseData.address, { align: 'left' });
        doc.moveDown(0.5);
      }
      
      // Map reference
      if (caseData.map_ref) {
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text('MAP REF:', { align: 'left' });
        doc.fontSize(16).font('Helvetica');
        doc.text(caseData.map_ref, { align: 'left' });
        doc.moveDown(0.5);
      }
      
      // Radio channel (for fire)
      if (caseData.radio_channel) {
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text('RADIO:', { align: 'left' });
        doc.fontSize(16).font('Helvetica');
        doc.text(caseData.radio_channel, { align: 'left' });
      }
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Generate full case log PDF (after-action report)
function generateCaseLog(caseData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Header
      doc.fontSize(18).font('Helvetica-Bold');
      doc.text('CASE LOG', { align: 'center' });
      doc.moveDown(0.3);
      
      doc.fontSize(14).font('Helvetica');
      doc.text(caseData.case_number, { align: 'center' });
      doc.moveDown(0.3);
      
      doc.fontSize(10);
      doc.text(`Generated: ${moment().format('DD/MM/YYYY HH:mm:ss')}`, { align: 'center' });
      doc.moveDown(1);
      
      // Divider
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(1);
      
      // Case Details Section
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('CASE DETAILS');
      doc.moveDown(0.5);
      
      doc.fontSize(10).font('Helvetica');
      
      const details = [
        ['Service', caseData.service ? caseData.service.toUpperCase() : 'Unknown'],
        ['Status', caseData.status || 'Unknown'],
        ['Address', caseData.address || 'Not specified'],
        ['Map Reference', caseData.map_ref || 'Not specified'],
        ['First Seen', caseData.first_seen ? moment.unix(caseData.first_seen).format('DD/MM/YYYY HH:mm:ss') : 'Unknown'],
        ['Last Updated', caseData.last_updated ? moment.unix(caseData.last_updated).format('DD/MM/YYYY HH:mm:ss') : 'Unknown']
      ];
      
      if (caseData.radio_channel) {
        details.push(['Radio Channel', caseData.radio_channel]);
      }
      
      if (caseData.is_major) {
        details.push(['Major Incident', 'YES']);
      }
      
      if (caseData.incident_level >= 2) {
        details.push(['Incident Level', caseData.incident_level.toString()]);
      }
      
      details.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value);
      });
      
      doc.moveDown(1);
      
      // Units Assigned Section
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('UNITS ASSIGNED');
      doc.moveDown(0.5);
      
      const resources = caseData.resources || [];
      if (resources.length > 0) {
        doc.fontSize(10).font('Helvetica');
        resources.forEach(r => {
          const time = r.first_seen ? moment.unix(r.first_seen).format('HH:mm:ss') : '';
          doc.text(`• ${r.resource_code} (${time})`);
        });
      } else {
        doc.fontSize(10).font('Helvetica').text('No units assigned');
      }
      
      doc.moveDown(1);
      
      // Messages Section
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('MESSAGE LOG');
      doc.moveDown(0.5);
      
      const messages = caseData.messages || [];
      if (messages.length > 0) {
        doc.fontSize(9).font('Courier');
        messages.forEach(m => {
          const time = m.timestamp ? moment.unix(m.timestamp).format('HH:mm:ss') : '';
          const source = m.source ? ` [${m.source}]` : '';
          doc.font('Helvetica-Bold').fontSize(9).text(`${time}${source}`, { continued: false });
          doc.font('Courier').fontSize(9).text(m.message || '');
          doc.moveDown(0.3);
        });
      } else {
        doc.fontSize(10).font('Helvetica').text('No messages recorded');
      }
      
      doc.moveDown(1);
      
      // Notes Section
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('NOTES');
      doc.moveDown(0.5);
      
      const notes = caseData.notes || [];
      if (notes.length > 0) {
        doc.fontSize(10).font('Helvetica');
        notes.forEach(n => {
          const time = n.timestamp ? moment.unix(n.timestamp).format('HH:mm:ss') : '';
          const author = n.author ? ` - ${n.author}` : '';
          doc.font('Helvetica-Bold').text(`${time}${author}`);
          doc.font('Helvetica').text(n.note || '');
          doc.moveDown(0.3);
        });
      } else {
        doc.fontSize(10).font('Helvetica').text('No notes recorded');
      }
      
      // Footer
      doc.moveDown(2);
      doc.fontSize(8).font('Helvetica');
      doc.text('--- End of Case Log ---', { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateDispatchSlip,
  generateCaseLog
};
