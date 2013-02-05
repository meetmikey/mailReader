var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , async = require('async')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var attachmentHandler = this;

exports.uploadAttachments = function( mail, mailId, userId, callback ) {
  if ( mail.attachments && mail.attachments.length ) {
    async.forEach( mail.attachments, 
      function(mailAttachment, forEachCallback) {
        attachmentHandler.uploadAttachment(mailAttachment, mail, mailId, userId, forEachCallback);
      },
      function(err) {
        callback(err);
      }
    );
  } else {
    callback();
  }
}

exports.uploadAttachment = function(mailAttachment, mail, mailId, userId, callback) {
  //winston.info('uploadAttachment');

  var filename = mailAttachment.fileName;
  var contentType = mailAttachment.contentType;
  var size = mailAttachment.length;
  var sender = mailUtils.getSender(mail);

  var attachment = new AttachmentModel({
      userId: userId
    , mailId: mailId
    , filename: filename
    , contentType: contentType
    , size: size
    , sentDate: mailUtils.getSentDate(mail)
    , sender: sender
    , recipients: mailUtils.getAllRecipients(mail)
    //, image: image //If it's an image itself, we'll set a signedURL on this in the route.
  });

  var attachmentId = attachment._id;

  var headers = {
    'Content-Type': mailAttachment.contentType,
    'Content-Length': mailAttachment.length,
    "x-amz-server-side-encryption" : "AES256",
    "Content-Disposition" : 'attachment; filename=' + mailAttachment.fileName
  }
  var s3Path = mailUtils.getAttachmentS3Path(attachmentId);
  s3Utils.client.putBuffer(mailAttachment.content, s3Path, headers,
    function(err, res) {
      if ( err ) {
        callback( winston.makeS3Error(err) );
      } else {
        //winston.info('saving attachment to db...');
        attachment.save( function(err) {
          if ( err ) {
            callback( winston.makeMongoError(err) );
          } else {
            //winston.info('attachment saved');
            callback();
          }
        });
      }
    }
  );
}