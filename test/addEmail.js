var sqsConnect = require('../serverCommon/lib/sqsConnect')


console.log('addEmail app running...');

var messageObject = { 'path' : '/home/jdurack/Documents/emails/emailWith4Attachments.txt' }
var message = JSON.stringify( messageObject );
sqsConnect.addMessageToMailReaderQueue( message );