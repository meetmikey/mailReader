var serverCommon = process.env.SERVER_COMMON;

var MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , async = require('async')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , attachmentHandler = require('../lib/attachmentHandler')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var mailParser = new MailParser();
mailParser.on('end', function(mail) {
  readMail(mail);
});

var filename = './test/data/calendarInvite2.txt';
var userId = 'TEST_USER';

fs.readFile(filename, function(err, data) {
  if ( err ) {
    winston.doError('failed to read file', {err: err});

  } else if ( ! data ) {
    winston.doMissingParamError('data');

  } else {
    mailParser.write(data);
    mailParser.end();
  }
});

readMail = function(mail) {
  //winston.doInfo('reading mail: ', {mail:mail});
  winston.doInfo('got mail with subject: ', {subject: mail.subject});
  async.forEach( mail.attachments, 
    function(mailAttachment, forEachCallback) {
      checkAttachment(mailAttachment, forEachCallback);
    }, function(err) {
      winston.handleError(err);
    }
  );
}

checkAttachment = function(mailAttachment, callback) {
  if ( mailAttachment && mailAttachment.fileName ) {
    winston.doInfo('got attachment: ' + mailAttachment.fileName);
    var isPromotable = attachmentHandler.isPromotable( mailAttachment );
    winston.doInfo('isPromotable?', {isPromotable: isPromotable});

  } else {
    delete( mailAttachment.content );
    winston.doInfo('bad attachment', {mailAttachment: mailAttachment});
  }
}