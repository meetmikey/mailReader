var serverCommon = process.env.SERVER_COMMON;

var MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , async = require('async')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var mailParser = new MailParser();
mailParser.on('end', function(mail) {
  readMail(mail);
});

var outputPath = '/home/jdurack/Desktop/attachmentOutput.docx';
var userId = 'TEST_USER';

var cloudPath = '/rawEmail/BAD_MAIL.txt';
cloudStorageUtils.getFile(cloudPath, true, function(err, res) {
  if ( err ) {
    winston.doS3Error(err);

  } else if ( ! res ) {
    callback( winston.makeMissingParamError('res') );

  } else {
    res.on('data', function(data) {
      mailParser.write(data);
    });
    res.on('end', function() {
      mailParser.end();
    });
  }
});

/*
var path = '/home/jdurack/Desktop/badMail.txt';
fs.readFile(path, function(err, data) {
  //winston.info('data: ', data);
  mailParser.write(data);
  mailParser.end();
});
*/

readMail = function(mail) {
  //winston.info('reading mail: ', mail);
  winston.info('got mail with subject: ' + mail.subject);
  async.forEach( mail.attachments, 
    function(mailAttachment, forEachCallback) {
      checkAttachment(mailAttachment, forEachCallback);
    }, function(err) {
      winston.handleError(err);
    }
  );
}

checkAttachment = function(mailAttachment, callback) {
  winston.info('got attachment: ' + mailAttachment.fileName);

  //fs.writeFileSync(outputPath, mailAttachment.content);
  //winston.info('written to disk');

  var headers = {
    'Content-Type': mailAttachment.contentType,
    'Content-Length': mailAttachment.length,
    "x-amz-server-side-encryption" : "AES256",
    "Content-Disposition" : 'attachment; filename=' + mailAttachment.fileName
  }

  var dummyAttachment = new AttachmentModel({});

  var cloudPath = cloudStorageUtils.getAttachmentPath(dummyAttachment);
  cloudStorageUtils.putBuffer(mailAttachment.content, cloudPath, headers, true,
    function(err, res) {
      if ( err ) {
        callback( err );
      } else {
        callback();
      }
    }
  );
}