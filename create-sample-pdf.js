import PDFDocument from 'pdfkit';
import fs from 'fs';

// Create PDF
const doc = new PDFDocument();
const stream = fs.createWriteStream('public/sample.pdf');

doc.pipe(stream);

// Add content
doc.fontSize(20).text('API Documentation: Get User Active Schedule', { underline: true });
doc.moveDown();

doc.fontSize(14).text('Endpoint Details', { underline: true });
doc.moveDown(0.5);

doc.fontSize(11);
doc.text('Endpoint Name: /v1/internal/auto-donation/:user_id/active-schedules', { width: 500 });
doc.text('HTTP Method: GET', { width: 500 });
doc.text('Authentication: Basic Auth + Signature Header', { width: 500 });
doc.text('API Status: stable (v1.84.0)', { width: 500 });
doc.moveDown();

doc.fontSize(14).text('Description', { underline: true });
doc.moveDown(0.5);

doc.fontSize(11);
doc.text('This endpoint retrieves all active schedules of auto donations that a user has set up. It returns a list of schedule IDs, their current status (ACTIVE or INACTIVE_INSUFFICIENT_BALANCE), and their category (e.g., SEDEKAH_SUBUH or DIRECT_TO_CAMPAIGN).', { width: 500 });
doc.moveDown();

doc.fontSize(14).text('Query Parameters', { underline: true });
doc.moveDown(0.5);

doc.fontSize(11);
doc.text('user_id (required): The unique identifier of the user', { width: 500 });
doc.moveDown();

doc.fontSize(14).text('Response Format', { underline: true });
doc.moveDown(0.5);

doc.fontSize(10);
doc.text(JSON.stringify({
    "response_code": "000000",
    "response_desc": { "id": "", "en": "" },
    "meta": {
        "version": "v1.84.0",
        "api_status": "stable",
        "api_env": "stg"
    },
    "data": [
        { "id": 717, "status": "ACTIVE", "category": "SEDEKAH_SUBUH" }
    ]
}, null, 2), { width: 500 });

doc.moveDown();
doc.fontSize(14).text('Business Logic', { underline: true });
doc.moveDown(0.5);

doc.fontSize(11);
doc.text('1. Only retrieve schedules with status ACTIVE or INACTIVE_INSUFFICIENT_BALANCE', { width: 500 });
doc.text('2. If schedule directly donates to campaign, set category as DIRECT_TO_CAMPAIGN', { width: 500 });
doc.text('3. Join with auto_donation_statuses and auto_donation_program_categories tables', { width: 500 });

doc.end();

stream.on('finish', () => {
    console.log('Sample PDF created at public/sample.pdf');
});
