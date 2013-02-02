var sqsConnect = require(serverCommon + '/lib/sqsConnect')

console.log('addEmail app running...');

var message = {
    'path': '/home/jdurack/Documents/emails/emailWith4Attachments.txt'
  , 'userId': '50f5034a0e189c3b48000006'
}
sqsConnect.addMessageToMailReaderQueue( message );