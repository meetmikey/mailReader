var sqsConnect = require('../../serverCommon/lib/sqsConnect')

console.log('addEmail app running...');

var message = {
    'path': '/home/jdurack/Documents/emails/emailWith4Attachments.txt'
  , 'userId': 'asdf'
}
sqsConnect.addMessageToMailReaderQueue( message );